/**
 * P3: дедуп повторной отправки по content SHA256 (копия файла в другом пути).
 *
 * Подтверждённый сценарий:
 *   generate_report → setSessionFile(original.pdf) → доставка на agent_end →
 *   LLM: bash cp original.pdf /tmp/copy.pdf → send_file(/tmp/copy.pdf)
 * → раньше происходила вторая отправка (другой realpath, нет dedupeKey).
 *
 * Фикс: SHA256 содержимого — ДОПОЛНИТЕЛЬНЫЙ сигнал внутри существующего
 * session-scoped + TTL механизма, и только против session-file записей с
 * dedupeKey (сгенерированные отчёты). Прямые send_file не регистрируются в
 * recent — одинаковый SHA256 у разных логических файлов НЕ подавляется.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONTENT_HASH_MAX_BYTES,
  setSessionFile,
  takeSessionFileRecord,
} from "../../src/utils/telegram/session-files.js";
import {
  setSessionContext,
} from "../../.pi/extensions/user-rules/context.js";
import {
  setTelegramFileAclCheck,
  setTelegramFileSender,
  type TelegramFileSendInput,
} from "../../.pi/extensions/telegram-bot/file-send-bridge.js";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-dup-"));
  tmpDirs.push(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

let seq = 0;
/** Уникальная сессия на тест — нет утечек между registry (file/recent/in-flight). */
function freshSession(): { sessionId: string; ctx: ExtensionContext } {
  const sessionId = `sess-p3-${++seq}`;
  setSessionContext(sessionId, { chatId: "-100", userId: "1" });
  const ctx = {
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext;
  return { sessionId, ctx };
}

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { filePath?: string; storageKey?: string; dedupeKey?: string },
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  }>;
}

async function loadSendFileTool(): Promise<CapturedTool> {
  const mod = await import("../../.pi/extensions/telegram-file-send/index.js");
  let captured: CapturedTool | null = null;
  const pi = {
    registerTool: (t: unknown) => {
      const cand = t as CapturedTool;
      if (cand.name === "send_file") captured = cand;
    },
  } as unknown as ExtensionAPI;
  mod.default(pi);
  if (!captured) throw new Error("send_file не зарегистрирован");
  return captured;
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setImmediate(r));
  }
}

const PDF_BYTES = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";

describe("send_file content-hash dedupe (P3)", () => {
  it("TEST 1: original доставлен через session-file → /tmp-копия подавлена (1 outbound)", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const original = tmpFile("report.pdf", PDF_BYTES);
    const copy = tmpFile("copy.pdf", PDF_BYTES); // тот же SHA256, другой путь
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });

    // PATH A: отчёт зарегистрирован и доставлен на agent_end.
    setSessionFile(ctx.sessionManager.getSessionId(), original, undefined, {
      dedupeKey: "report:expense-report",
    });
    takeSessionFileRecord(ctx.sessionManager.getSessionId());

    // PATH B: LLM скопировал отчёт и шлёт копию.
    const res = await tool.execute("c1", { filePath: copy }, null, null, ctx);

    assert.equal(sent.length, 0, "копия не должна отправляться повторно");
    assert.equal(res.details?.suppressed, true);
  });

  it("TEST 2: file-A и file-B с разным содержимым → оба отправляются", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const a = tmpFile("a.pdf", "content-AAA");
    const b = tmpFile("b.pdf", "content-BBB");
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });

    const r1 = await tool.execute("c1", { filePath: a }, null, null, ctx);
    const r2 = await tool.execute("c2", { filePath: b }, null, null, ctx);

    assert.equal(sent.length, 2);
    assert.equal(r1.details?.suppressed, undefined);
    assert.equal(r2.details?.suppressed, undefined);
  });

  it("TEST 3: существующий dedupeKey-дедуп сохраняется", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const p1 = tmpFile("r1.pdf", "x");
    const p2 = tmpFile("r2.pdf", "y"); // другой путь/содержимое
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });
    setSessionFile(ctx.sessionManager.getSessionId(), p1, undefined, {
      dedupeKey: "report:expense-report",
    });

    const res = await tool.execute(
      "c1",
      { filePath: p2, dedupeKey: "report:expense-report" },
      null,
      null,
      ctx,
    );

    assert.equal(sent.length, 0, "тот же dedupeKey — подавлено");
    assert.equal(res.details?.suppressed, true);
    takeSessionFileRecord(ctx.sessionManager.getSessionId());
  });

  it("TEST 4: существующий realpath-дедуп сохраняется", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const p = tmpFile("delivered.pdf", "x");
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });
    setSessionFile(ctx.sessionManager.getSessionId(), p);
    takeSessionFileRecord(ctx.sessionManager.getSessionId()); // доставка

    const res = await tool.execute("c1", { filePath: p }, null, null, ctx);

    assert.equal(sent.length, 0);
    assert.equal(res.details?.suppressed, true);
  });

  it("TEST 5: одинаковый SHA256, но разные логические artifacts (прямые send_file) → оба", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    // Два РАЗНЫХ логических файла с одинаковыми байтами, оба шлются напрямую
    // (нет session-file lifecycle → content-hash дедуп не применяется).
    const a = tmpFile("one.pdf", "identical-bytes");
    const b = tmpFile("two.pdf", "identical-bytes");
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });

    const r1 = await tool.execute("c1", { filePath: a }, null, null, ctx);
    const r2 = await tool.execute("c2", { filePath: b }, null, null, ctx);

    assert.equal(sent.length, 2, "разные логические файлы не подавляются");
    assert.equal(r1.details?.suppressed, undefined);
    assert.equal(r2.details?.suppressed, undefined);
  });

  it("TEST 6: SHA256 недоступен (файл больше порога) → send не ломается", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const p = tmpFile("big.pdf", Buffer.alloc(CONTENT_HASH_MAX_BYTES + 1));
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });

    const res = await tool.execute("c1", { filePath: p }, null, null, ctx);

    assert.equal(sent.length, 1, "без hash отправка продолжается по старым правилам");
    assert.equal(res.details?.suppressed, undefined);
    assert.equal(res.details?.fileId, undefined); // mock без fileId
  });

  it("TEST 7: concurrent duplicate send → только один outbound", async () => {
    const tool = await loadSendFileTool();
    const { ctx } = freshSession();
    const p = tmpFile("race.pdf", "race-content");
    setTelegramFileAclCheck(async () => true);
    let count = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setTelegramFileSender(async () => {
      count += 1;
      await gate; // первый вызов блокируется, пока второй не доходит до проверки
      return { ok: true };
    });

    const first = tool.execute("c1", { filePath: p }, null, null, ctx);
    await waitFor(() => count === 1); // первый уже внутри sender (in-flight помечен)
    const second = tool.execute("c2", { filePath: p }, null, null, ctx);
    const secondRes = await second;
    release();
    await first;

    assert.equal(count, 1, "ровно один вызов sender");
    assert.equal(secondRes.details?.suppressed, true);
  });
});
