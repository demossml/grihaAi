import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  validateSendFile,
  TELEGRAM_MAX_FILE_BYTES,
} from "../../.pi/extensions/telegram-bot/file-send.js";
import {
  setTelegramFileSender,
  setTelegramFileAclCheck,
  type TelegramFileSendInput,
} from "../../.pi/extensions/telegram-bot/file-send-bridge.js";
import telegramFileSend from "../../.pi/extensions/telegram-file-send/index.js";
import {
  clearSessionContext,
  setSessionContext,
} from "../../.pi/extensions/user-rules/context.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sendfile-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  setTelegramFileSender(null);
  setTelegramFileAclCheck(null);
  clearSessionContext("sess-1");
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("validateSendFile", () => {
  it("существующий обычный файл в разрешённом корне → ok", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "report.pdf");
    fs.writeFileSync(file, "pdf-bytes");
    const res = validateSendFile(file, { allowedRoots: [dir] });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.sizeBytes, 9);
      // realpath на macOS ведёт через /private — сравниваем по имени файла.
      assert.ok(res.resolvedPath.endsWith("report.pdf"));
    }
  });

  it("файл не найден → понятная ошибка", () => {
    const dir = makeTmpDir();
    const res = validateSendFile(path.join(dir, "nope.txt"), { allowedRoots: [dir] });
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("Файл не найден"));
  });

  it("директория → «не файл»", () => {
    const dir = makeTmpDir();
    const res = validateSendFile(dir, { allowedRoots: [dir] });
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("не файл"));
  });

  it("превышение лимита → ошибка, не пытаемся слать", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "big.bin");
    fs.writeFileSync(file, Buffer.alloc(1024));
    const res = validateSendFile(file, { maxBytes: 100, allowedRoots: [dir] });
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("больше лимита"));
  });

  it("путь вне разрешённых корней → отказ", () => {
    const dir = makeTmpDir();
    const other = makeTmpDir();
    const file = path.join(other, "secret.txt");
    fs.writeFileSync(file, "s");
    const res = validateSendFile(file, { allowedRoots: [dir] });
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("вне разрешённых"));
  });

  it("дефолтный лимит — 50 МБ для ботов", () => {
    assert.equal(TELEGRAM_MAX_FILE_BYTES, 50 * 1024 * 1024);
  });
});

describe("send_file tool", () => {
  interface CapturedTool {
    name: string;
    execute: (
      toolCallId: string,
      params: { filePath: string; caption?: string },
      signal: unknown,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }>;
  }

  function loadTool(): CapturedTool {
    let captured: CapturedTool | null = null;
    const pi = {
      registerTool: (t: unknown) => {
        captured = t as CapturedTool;
      },
    } as unknown as ExtensionAPI;
    telegramFileSend(pi);
    if (!captured) throw new Error("tool not registered");
    return captured;
  }

  const ctx = {
    sessionManager: { getSessionId: () => "sess-1" },
  } as unknown as ExtensionContext;

  it("успешная отправка: chatId/threadId из контекста сессии, статус с file_id/message_id", async () => {
    const tool = loadTool();
    const dir = makeTmpDir();
    const file = path.join(dir, "отчёт.pdf");
    fs.writeFileSync(file, "data");
    setSessionContext("sess-1", { chatId: "-5239797479", userId: "5700958253", threadId: "15" });
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true, fileId: "file_1", messageId: 77 };
    });

    const res = await tool.execute("tc1", { filePath: file, caption: "отчёт" }, null, null, ctx);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, -5239797479, "chatId из контекста сессии");
    assert.equal(sent[0].threadId, 15, "форум: та же тема");
    assert.equal(sent[0].caption, "отчёт");
    assert.ok(sent[0].filePath.endsWith("отчёт.pdf"));
    assert.equal(res.content[0].type, "text");
    assert.ok(res.content[0].text!.includes("Файл отправлен"));
    assert.ok(res.content[0].text!.includes("file_id=file_1"));
    assert.ok(res.content[0].text!.includes("message_id=77"));
  });

  it("без контекста Telegram-сессии → отказ", async () => {
    const tool = loadTool();
    setTelegramFileSender(async () => ({ ok: true }));
    const res = await tool.execute("tc1", { filePath: "/tmp/x" }, null, null, ctx);
    assert.ok(res.content[0].text!.includes("только в Telegram-чате"));
  });

  it("файл не найден → понятная ошибка, sender не вызван", async () => {
    const tool = loadTool();
    const dir = makeTmpDir();
    setSessionContext("sess-1", { chatId: "-100", userId: "42" });
    setTelegramFileAclCheck(async () => true);
    let calls = 0;
    setTelegramFileSender(async () => {
      calls++;
      return { ok: true };
    });
    const res = await tool.execute("tc1", { filePath: path.join(dir, "nope.txt") }, null, null, ctx);
    assert.ok(res.content[0].text!.includes("Файл не найден"));
    assert.equal(calls, 0);
  });

  it("ACL запрещает → отказ до отправки", async () => {
    const tool = loadTool();
    const dir = makeTmpDir();
    const file = path.join(dir, "f.txt");
    fs.writeFileSync(file, "x");
    setSessionContext("sess-1", { chatId: "-100", userId: "999" });
    setTelegramFileAclCheck(async () => false);
    let calls = 0;
    setTelegramFileSender(async () => {
      calls++;
      return { ok: true };
    });
    const res = await tool.execute("tc1", { filePath: file }, null, null, ctx);
    assert.ok(res.content[0].text!.includes("Нет доступа"));
    assert.equal(calls, 0);
  });

  it("сетевая ошибка отправителя → возвращается ошибка", async () => {
    const tool = loadTool();
    const dir = makeTmpDir();
    const file = path.join(dir, "f.txt");
    fs.writeFileSync(file, "x");
    setSessionContext("sess-1", { chatId: "-100", userId: "42" });
    setTelegramFileAclCheck(async () => true);
    setTelegramFileSender(async () => ({ ok: false, error: "Не удалось отправить файл (лимиты/сеть Telegram)." }));
    const res = await tool.execute("tc1", { filePath: file }, null, null, ctx);
    assert.ok(res.content[0].text!.includes("Не удалось отправить"));
  });
});
