/**
 * E4: дедуп отправки PDF-отчёта (skill-правила + код-дедуп).
 *
 * - session-file зарегистрирован (автодоставка на agent_end) → send_file
 *   того же path/dedupeKey подавляется;
 * - после take (доставка) → send_file того же path подавляется (TTL 10 мин);
 * - два инструмента с одним dedupeKey → один outbound;
 * - skills содержат явные правила PDF-отчётов.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasPendingDedupeKey,
  hasPendingSessionFile,
  markRecentlySentFile,
  peekSessionFileRecord,
  setSessionFile,
  takeSessionFileRecord,
  wasRecentlySentFile,
} from "../../src/utils/telegram/session-files.js";
import {
  setSessionContext,
  clearSessionContext,
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
function tmpFile(name = "report.pdf"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e4-dup-"));
  tmpDirs.push(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, "%PDF-fake");
  return p;
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

const ctx = {
  sessionManager: { getSessionId: () => "sess-e4" },
} as unknown as ExtensionContext;

describe("session-files dedupe API (E4)", () => {
  it("pending: setSessionFile с dedupeKey → hasPendingSessionFile/hasPendingDedupeKey", () => {
    const p = tmpFile();
    setSessionFile("s1", p, undefined, { dedupeKey: "k" });
    assert.equal(hasPendingSessionFile("s1", p), true);
    assert.equal(hasPendingSessionFile("s1", tmpFile("other.pdf")), false);
    assert.equal(hasPendingDedupeKey("s1", "k"), true);
    assert.equal(hasPendingDedupeKey("s1", "other"), false);
    assert.equal(peekSessionFileRecord("s1")?.dedupeKey, "k");
    const taken = takeSessionFileRecord("s1");
    assert.equal(taken?.filePath, p);
    assert.equal(hasPendingSessionFile("s1", p), false, "после take — очереди нет");
  });

  it("recently sent: TTL-дедуп по path в рамках сессии", () => {
    const p = tmpFile();
    const q = tmpFile("other2.pdf");
    assert.equal(wasRecentlySentFile("s2", p), false);
    markRecentlySentFile("s2", p);
    assert.equal(wasRecentlySentFile("s2", p), true);
    assert.equal(wasRecentlySentFile("s2", q), false);
  });

  it("два инструмента с одним dedupeKey → одна pending-запись (last-wins)", () => {
    const p1 = tmpFile("r1.pdf");
    const p2 = tmpFile("r2.pdf");
    setSessionFile("s3", p1, undefined, { dedupeKey: "expense-report" });
    setSessionFile("s3", p2, undefined, { dedupeKey: "expense-report" });
    const rec = peekSessionFileRecord("s3");
    assert.equal(rec?.filePath, p2);
    assert.equal(rec?.dedupeKey, "expense-report");
    takeSessionFileRecord("s3");
  });
});

describe("send_file dedupe (E4)", () => {
  it("session-file pending (автодоставка) → send_file того же path подавлен", async () => {
    const tool = await loadSendFileTool();
    const p = tmpFile("report.pdf");
    setSessionContext("sess-e4", { chatId: "-100", userId: "1" });
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });
    setSessionFile("sess-e4", p, undefined, { dedupeKey: "report:expense-report" });

    const res = await tool.execute("c1", { filePath: p }, null, null, ctx);

    assert.equal(sent.length, 0, "sender не вызывается повторно");
    assert.ok(res.content[0]!.text!.includes("повторная отправка подавлена"));
    assert.equal(res.details?.suppressed, true);
    takeSessionFileRecord("sess-e4");
  });

  it("после take (доставка на agent_end) → send_file того же path подавлен", async () => {
    const tool = await loadSendFileTool();
    const p = tmpFile("delivered.pdf");
    setSessionContext("sess-e4", { chatId: "-100", userId: "1" });
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });
    setSessionFile("sess-e4", p);
    takeSessionFileRecord("sess-e4"); // эмуляция доставки

    const res = await tool.execute("c2", { filePath: p }, null, null, ctx);

    assert.equal(sent.length, 0);
    assert.equal(res.details?.suppressed, true);
  });

  it("dedupeKey совпал с pending → подавлен; другой ключ → отправлен", async () => {
    const tool = await loadSendFileTool();
    const p1 = tmpFile("a.pdf");
    const p2 = tmpFile("b.pdf");
    setSessionContext("sess-e4", { chatId: "-100", userId: "1" });
    setTelegramFileAclCheck(async () => true);
    const sent: TelegramFileSendInput[] = [];
    setTelegramFileSender(async (input) => {
      sent.push(input);
      return { ok: true };
    });
    setSessionFile("sess-e4", p1, undefined, { dedupeKey: "report:expense-report" });

    // Другой путь, но тот же dedupeKey → подавлен.
    const sup = await tool.execute(
      "c3",
      { filePath: p2, dedupeKey: "report:expense-report" },
      null,
      null,
      ctx,
    );
    assert.equal(sup.details?.suppressed, true);
    assert.equal(sent.length, 0);

    // Другой ключ → обычная отправка.
    const ok = await tool.execute(
      "c4",
      { filePath: p2, dedupeKey: "other-key" },
      null,
      null,
      ctx,
    );
    assert.equal(ok.details?.suppressed, undefined);
    assert.equal(sent.length, 1);

    takeSessionFileRecord("sess-e4");
    clearSessionContext("sess-e4");
  });
});

describe("skills: правила PDF-отчётов (E4)", () => {
  const skillsRoot = path.resolve(
    process.cwd(),
    "../../packages/skills/skills",
  );

  it("expenses skill содержит раздел Expense reports (PDF) и запреты", () => {
    const text = fs.readFileSync(path.join(skillsRoot, "expenses/SKILL.md"), "utf8");
    assert.match(text, /Expense reports \(PDF\)/);
    assert.match(text, /generate_report\(reportType: "expense-report"\)/);
    assert.match(text, /Do NOT call `send_file`/);
    assert.match(text, /Do NOT also call `generate_report` with empty data/);
  });

  it("financial-report skill запрещает send_file после PDF-инструмента", () => {
    const text = fs.readFileSync(path.join(skillsRoot, "financial-report/SKILL.md"), "utf8");
    assert.match(text, /generate_report\(reportType: "expense-report"\)/);
    assert.match(text, /Do NOT call `send_file` after the PDF tool/);
    assert.match(text, /do NOT invent tables/);
  });
});
