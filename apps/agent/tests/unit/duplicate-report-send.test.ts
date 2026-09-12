/**
 * FIX: duplicate expense PDF send (D1–D7).
 * Root cause: expenses_report_pdf → setSessionFile → автоотправка; LLM ещё зовёт
 * send_file на тот же path; финальный текст «Готово!». Дедуп в коде, не в prompt.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasPendingSessionFile,
  markRecentlySentFile,
  peekSessionFileRecord,
  setSessionFile,
  takeSessionFileRecord,
  wasRecentlySentFile,
} from "../../src/utils/telegram/session-files.js";
import { checkSendFileDuplicates } from "../../.pi/extensions/telegram-file-send/index.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpFile(name = "report.pdf"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dup-"));
  tmpDirs.push(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, "%PDF-fake");
  return p;
}

describe("session-files dedupe (D2)", () => {
  it("отчёт поставил файл в очередь → hasPendingSessionFile true для того же path", () => {
    const p = tmpFile();
    setSessionFile("s1", p, undefined, { attachmentOnly: true, dedupeKey: "k" });
    assert.equal(hasPendingSessionFile("s1", p), true);
    assert.equal(hasPendingSessionFile("s1", tmpFile("other.pdf")), false, "другой путь не подавляется");
    assert.equal(peekSessionFileRecord("s1")?.dedupeKey, "k");
    const taken = takeSessionFileRecord("s1");
    assert.equal(taken?.filePath, p);
    assert.equal(hasPendingSessionFile("s1", p), false, "после take — очереди нет");
  });

  it("канонический путь: симлинк/относительный совпадает с absolute", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dup2-"));
    tmpDirs.push(dir);
    const real = path.join(dir, "r.pdf");
    fs.writeFileSync(real, "x");
    const link = path.join(dir, "link.pdf");
    fs.symlinkSync(real, link);
    setSessionFile("s1", real);
    assert.equal(hasPendingSessionFile("s1", link), true, "realpath совпадает");
  });

  it("recently sent: TTL-дедуп по path в рамках сессии", () => {
    const p = tmpFile();
    const q = tmpFile("other2.pdf");
    assert.equal(wasRecentlySentFile("s1", p), false);
    markRecentlySentFile("s1", p);
    assert.equal(wasRecentlySentFile("s1", p), true);
    assert.equal(wasRecentlySentFile("s1", q), false);
  });
});

describe("send_file dedupe (D2/D5)", () => {
  it("report pending + send_file тот же path → suppress (0 отсылок)", () => {
    const p = tmpFile();
    setSessionFile("s1", p);
    const reason = checkSendFileDuplicates("s1", p);
    assert.equal(reason, "Файл уже поставлен в очередь отправки.");
  });

  it("recently sent + send_file тот же path → suppress", () => {
    const p = tmpFile();
    markRecentlySentFile("s1", p);
    assert.equal(checkSendFileDuplicates("s1", p), "Файл уже отправлен недавно.");
  });

  it("другой путь не подавляется", () => {
    const p = tmpFile("a.pdf");
    const q = tmpFile("b.pdf");
    setSessionFile("s1", p);
    assert.equal(checkSendFileDuplicates("s1", q), undefined);
  });
});

describe("attachmentOnly → без текста (D3)", () => {
  it("агент вернул attachmentOnly → один outbound: файл без текста/подписи", async () => {
    const p = tmpFile();
    const sent: Array<{ text: string; filePath?: string; extra?: { documentCaption?: string } }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "Готово! Отчёт по расходам готов.", filePath: p, attachmentOnly: true }),
      async (_chatId, text, fp, extra) => {
        sent.push({ text, filePath: fp, extra });
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999, type: "private" }, text: "отчёт" },
    });
    assert.equal(res.handled, true);
    assert.equal(sent.length, 1, "ровно один outbound");
    assert.equal(sent[0].text, "", "«Готово!» не уходит");
    assert.equal(sent[0].filePath, p);
    assert.equal(sent[0].extra?.documentCaption, undefined);
  });
});
