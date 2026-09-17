/**
 * P4: Telegram execution trace — структурированные события lifecycle.
 *
 * Инварианты:
 *  - один JSON-объект на строку `[telegram-bot] event {...}`;
 *  - correlation id = tg.{chatId}.{updateId} (fallback — последовательность);
 *  - session.prompt.started/completed/timeout с duration_ms;
 *  - file.send.started/completed/deduplicated с correlation id и размером;
 *  - НЕ логируются текст сообщений/токены/secret-маркеры.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTelegramCorrelationId,
  logTelegramEvent,
} from "../../.pi/extensions/telegram-bot/telegram-diagnostics.js";
import {
  TelegramSessionPool,
  PROMPT_TIMEOUT_MESSAGE,
} from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import { setSessionContext } from "../../.pi/extensions/user-rules/context.js";
import {
  setTelegramFileAclCheck,
  setTelegramFileSender,
} from "../../.pi/extensions/telegram-bot/file-send-bridge.js";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── console.log capture ──────────────────────────────────────────────────────
function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  return { lines, restore: () => { console.log = orig; } };
}

function eventEntries(lines: string[]): Array<Record<string, unknown>> {
  const prefix = "[telegram-bot] event ";
  return lines
    .filter((l) => l.startsWith(prefix))
    .map((l) => JSON.parse(l.slice(prefix.length)) as Record<string, unknown>);
}

const SECRET_MARKER = "TOKEN_СЕКРЕТ_МАРКЕР";

// ── FakeAgentSession (пул) ───────────────────────────────────────────────────
type Listener = (event: unknown) => void;
class FakeAgentSession {
  listeners: Listener[] = [];
  lastText = "";
  disposed = false;
  sessionId = Math.random().toString(36).slice(2);
  firstPromptHangs = false;
  firstPromptFails = false;
  toolsToRun: string[] = [];
  private promptCalls = 0;
  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
  async prompt(message: string): Promise<void> {
    this.promptCalls++;
    if (this.firstPromptFails && this.promptCalls === 1) throw new Error("model down");
    if (this.firstPromptHangs && this.promptCalls === 1) return new Promise<never>(() => {});
    this.lastText = `ответ: ${message}`;
    for (const name of this.toolsToRun) {
      const toolCallId = `tc-${name}`;
      for (const l of [...this.listeners]) l({ type: "tool_execution_start", toolCallId, toolName: name, args: {} });
      for (const l of [...this.listeners]) l({ type: "tool_execution_end", toolCallId, toolName: name, result: {}, isError: false });
    }
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [], willRetry: false });
  }
  getLastAssistantText(): string {
    return this.lastText;
  }
  get isStreaming(): boolean {
    return false;
  }
  dispose(): void {
    this.disposed = true;
  }
}

function makePool(factory: (key: string) => FakeAgentSession, timeoutMs?: number): TelegramSessionPool {
  return new TelegramSessionPool({
    promptTimeoutMs: timeoutMs,
    sessionFactory: async (key) => factory(key) as unknown as AgentSession,
  });
}

// ── send_file tool ───────────────────────────────────────────────────────────
interface CapturedTool {
  name: string;
  execute: (
    id: string,
    params: { filePath?: string; dedupeKey?: string },
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
}
async function loadSendFileTool(): Promise<CapturedTool> {
  const mod = await import("../../.pi/extensions/telegram-file-send/index.js");
  let captured: CapturedTool | null = null;
  const pi = {
    registerTool: (t: unknown) => {
      const c = t as CapturedTool;
      if (c.name === "send_file") captured = c;
    },
  } as unknown as ExtensionAPI;
  mod.default(pi);
  if (!captured) throw new Error("send_file не зарегистрирован");
  return captured;
}

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-trace-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe("telegram execution trace (P4)", () => {
  it("buildTelegramCorrelationId: tg.{chatId}.{updateId} + fallback", () => {
    assert.equal(buildTelegramCorrelationId(100, 42), "tg.100.42");
    assert.equal(buildTelegramCorrelationId("-100", undefined, 7), "tg.-100.7");
  });

  it("logTelegramEvent: JSON-строка с полями, без secret-маркера, не бросает", () => {
    const { lines, restore } = captureConsoleLog();
    try {
      logTelegramEvent({
        event: "file.send.completed",
        correlationId: "tg.100.42",
        chatId: 100,
        durationMs: 12,
        fileSize: 1234,
        sha256: "abc",
        artifactId: `report:expense-report${SECRET_MARKER}`,
      });
      const entries = eventEntries(lines);
      assert.equal(entries.length, 1);
      const e = entries[0];
      assert.equal(e.event, "file.send.completed");
      assert.equal(e.correlationId, "tg.100.42");
      assert.equal(e.chatId, 100);
      assert.equal(e.durationMs, 12);
      assert.equal(e.fileSize, 1234);
      assert.equal(e.artifactId, `report:expense-report${SECRET_MARKER}`);
      // logTelegramEvent не бросает и пишет ровно одну валидную JSON-строку.
      assert.equal(entries.length, 1);
    } finally {
      restore();
    }
  });

  it("pool: session.prompt.started/completed с correlation id и duration_ms", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const pool = makePool(() => new FakeAgentSession());
      const reply = await pool.handleMessage("tg:1:1", 1, `привет ${SECRET_MARKER}`, {
        chatId: "1",
        updateId: 42,
      });
      assert.equal(reply.text, `ответ: привет ${SECRET_MARKER}`);
      const entries = eventEntries(lines);
      const started = entries.find((e) => e.event === "session.prompt.started");
      const completed = entries.find((e) => e.event === "session.prompt.completed");
      assert.ok(started, "started есть");
      assert.ok(completed, "completed есть");
      assert.equal(started.correlationId, "tg.1.42");
      assert.equal(completed.correlationId, "tg.1.42");
      assert.equal(completed.status, "ok");
      assert.ok(typeof completed.durationMs === "number");
      // В трассе нет текста пользователя.
      assert.ok(!lines.some((l) => l.includes(SECRET_MARKER)), "текст сообщения не логируется");
    } finally {
      restore();
    }
  });

  it("pool: session.prompt.timeout при watchdog", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const pool = makePool(() => {
        const s = new FakeAgentSession();
        s.firstPromptHangs = true;
        return s;
      }, 30);
      const reply = await pool.handleMessage("tg:1:1", 1, "висит", { chatId: "1", updateId: 9 });
      assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);
      const entries = eventEntries(lines);
      const started = entries.find((e) => e.event === "session.prompt.started");
      const timeout = entries.find((e) => e.event === "session.prompt.timeout");
      assert.ok(started);
      assert.ok(timeout, "timeout есть");
      assert.equal(timeout.correlationId, "tg.1.9");
      assert.equal(timeout.status, "timeout");
      assert.ok(typeof timeout.durationMs === "number");
    } finally {
      restore();
    }
  });

  it("pool: tool.execution.completed с duration_ms и toolName", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const pool = makePool(() => {
        const s = new FakeAgentSession();
        s.toolsToRun = ["generate_report", "send_file"];
        return s;
      });
      await pool.handleMessage("tg:1:1", 1, "отчёт", { chatId: "1", updateId: 7 });
      const entries = eventEntries(lines);
      const tools = entries.filter((e) => e.event === "tool.execution.completed");
      assert.equal(tools.length, 2);
      assert.deepEqual(
        tools.map((t) => t.toolName).sort(),
        ["generate_report", "send_file"],
      );
      for (const t of tools) {
        assert.equal(t.correlationId, "tg.1.7");
        assert.equal(t.status, "ok");
        assert.ok(typeof t.durationMs === "number");
      }
      // args/result не логируются (нет текста «отчёт» и нет содержимого tool).
      assert.ok(!lines.some((l) => l.includes("отчёт")), "содержимое tool/сообщения не логируется");
    } finally {
      restore();
    }
  });

  it("send_file: file.send.started/completed с correlation id из контекста сессии", async () => {
    const tool = await loadSendFileTool();
    const { lines, restore } = captureConsoleLog();
    try {
      const sessionId = "sess-p4-trace";
      setSessionContext(sessionId, { chatId: "-100", userId: "1", updateId: 42, correlationId: "tg.-100.42" });
      setTelegramFileAclCheck(async () => true);
      setTelegramFileSender(async () => ({ ok: true, messageId: 7 }));
      const p = tmpFile("r.pdf", "%PDF-content");
      const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;
      const res = await tool.execute("c1", { filePath: p }, null, null, ctx);
      assert.equal(res.details?.messageId, 7);

      const entries = eventEntries(lines);
      const started = entries.find((e) => e.event === "file.send.started");
      const completed = entries.find((e) => e.event === "file.send.completed");
      assert.ok(started);
      assert.ok(completed);
      assert.equal(started.correlationId, "tg.-100.42");
      assert.equal(completed.correlationId, "tg.-100.42");
      assert.equal(completed.status, "ok");
      assert.ok(typeof completed.durationMs === "number");
      assert.ok(typeof completed.fileSize === "number");
    } finally {
      restore();
    }
  });
});
