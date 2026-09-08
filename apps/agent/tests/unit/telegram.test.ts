import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import {
  TelegramBotController,
  type TelegramBotLike,
} from "../../.pi/extensions/telegram-bot/TelegramBotController.js";
import { TelegramSessionPool } from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import { setSessionFile } from "../../src/utils/session-files.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "@griha/config";
import type { GrishAiConfig } from "@griha/shared-types";

describe("telegram bridge", () => {
  it("parses a text update and routes it to the agent", async () => {
    const calls: Array<{ message: string; userId: number; sessionKey: string }> = [];
    const sent: Array<{ chatId: number; text: string }> = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push({ message: input.message, userId: input.userId, sessionKey: input.sessionKey });
        return { text: "ответ Гриши" };
      },
      async (chatId, text) => {
        sent.push({ chatId, text });
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
    });

    assert.equal(res.handled, true);
    assert.equal(calls[0].message, "привет");
    assert.equal(calls[0].sessionKey, "tg:123");
    assert.equal(sent[0].text, "ответ Гриши");
    assert.equal(sent[0].chatId, 999);
  });

  it("ignores messages from unknown users", async () => {
    let agentCalled = false;
    let sent = 0;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async () => {
        sent++;
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 2,
      message: { from: { id: 999 }, chat: { id: 1 }, text: "hi" },
    });

    assert.equal(res.handled, false);
    assert.equal(res.reason, "not-allowed");
    assert.equal(agentCalled, false);
    assert.equal(sent, 0);
  });

  it("handles /start and /status commands", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge([123], async () => ({ text: "x" }), async (_chatId, text) => {
      sent.push(text);
    });
    await bridge.handleUpdate({
      updateId: 4,
      message: { from: { id: 123 }, chat: { id: 1 }, text: "/start" },
    });
    await bridge.handleUpdate({
      updateId: 5,
      message: { from: { id: 123 }, chat: { id: 1 }, text: "/status" },
    });
    assert.ok(sent[0].includes("Гриша"));
    assert.ok(sent[1].includes("Гриша работает"));
  });

  it("drops messages blocked by the pre-filter without replying", async () => {
    let agentCalled = false;
    const sent: number[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async (chatId) => {
        sent.push(chatId);
      },
      { prefilter: () => false },
    );

    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
    });

    assert.equal(res.handled, true);
    assert.equal(res.reason, "blocked-by-rules");
    assert.equal(agentCalled, false);
    assert.equal(sent.length, 0);
  });

  it("routes /rules commands to the handler with chat context", async () => {
    let handledArgs = "";
    let handledCtx: { chatId: string; userId: string } | null = null;
    let sent = "";
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent = text;
      },
      {
        rulesHandler: (args, ctx) => {
          handledArgs = args;
          handledCtx = ctx;
          return "список правил";
        },
      },
    );

    await bridge.handleUpdate({
      updateId: 2,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "/rules add не отвечай чужим" },
    });

    assert.equal(handledArgs, "add не отвечай чужим");
    assert.deepEqual(handledCtx, { chatId: "999", userId: "123" });
    assert.equal(sent, "список правил");
  });

  it("saves telegram config and reads it back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-cfg-"));
    process.env.GRISH_AI_HOME = dir;
    try {
      const cfg: GrishAiConfig = {
        version: 1,
        provider: "deepseek",
        model: "deepseek-chat",
        setupCompletedAt: new Date().toISOString(),
        telegram: { botToken: "123:abc", allowedUserIds: [123, 456] },
      };
      saveConfig(cfg);
      const loaded = loadConfig();
      assert.equal(loaded?.telegram?.botToken, "123:abc");
      assert.deepEqual(loaded?.telegram?.allowedUserIds, [123, 456]);
    } finally {
      delete process.env.GRISH_AI_HOME;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends a document when the agent reply carries a file path", async () => {
    const sent: Array<{ chatId: number; text: string; filePath?: string }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "Готово", filePath: "/tmp/report.pdf" }),
      async (chatId, text, filePath) => {
        sent.push({ chatId, text, filePath });
      },
    );

    await bridge.handleUpdate({
      updateId: 6,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "сделай отчёт" },
    });

    assert.equal(sent[0].text, "Готово");
    assert.equal(sent[0].filePath, "/tmp/report.pdf");
  });
});

class FakeBot implements TelegramBotLike {
  started = 0;
  stopped = 0;
  handler: ((ctx: unknown) => unknown) | null = null;
  sent: Array<{ chatId: number; text: string }> = [];
  docs: Array<{ chatId: number; filePath: string }> = [];
  private stopResolve: (() => void) | null = null;

  on(_filter: "message", handler: (ctx: unknown) => unknown): void {
    this.handler = handler;
  }

  async start(): Promise<unknown> {
    // Как настоящий grammy: start() резолвится только после stop().
    this.started++;
    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
    return undefined;
  }

  async stop(): Promise<unknown> {
    this.stopped++;
    this.stopResolve?.();
    this.stopResolve = null;
    return undefined;
  }

  api = {
    sendMessage: async (chatId: number, text: string): Promise<unknown> => {
      this.sent.push({ chatId, text });
      return undefined;
    },
    sendDocument: async (chatId: number, filePath: string): Promise<unknown> => {
      this.docs.push({ chatId, filePath });
      return undefined;
    },
  };
}

describe("telegram bot controller", () => {
  it("starts and stops long polling", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake);

    controller.start("token");
    assert.equal(controller.isRunning(), true);
    assert.equal(fake.started, 1);
    assert.ok(fake.handler, "message handler should be wired");

    await controller.stop();
    assert.equal(controller.isRunning(), false);
    assert.equal(fake.stopped, 1);
  });

  it("does not restart when already running", () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake);
    controller.start("token");
    controller.start("token");
    assert.equal(fake.started, 1);
  });

  it("calls sendDocument with the file path from the agent reply", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(
      async () => ({ text: "Готово", filePath: "/tmp/report.pdf" }),
      [123],
      () => fake,
    );
    controller.start("token");

    await fake.handler?.({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "отчёт" },
    });
    // Let the async bridge/sender chain settle (FakeBot pushes synchronously).
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(fake.sent, [{ chatId: 999, text: "Готово" }]);
    assert.deepEqual(fake.docs, [{ chatId: 999, filePath: "/tmp/report.pdf" }]);
  });
});

class FakeAgentSession {
  sessionId = Math.random().toString(36).slice(2);
  listeners: Array<(event: unknown) => void> = [];
  prompts: string[] = [];
  lastText = "";
  disposed = false;
  /** When set, the session registers this file path before ending the turn. */
  pendingFile?: string;

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    if (this.pendingFile) setSessionFile(this.sessionId, this.pendingFile);
    this.lastText = `ответ на: ${message}`;
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [] });
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

describe("telegram session pool", () => {
  function makePool() {
    const sessions = new Map<number, FakeAgentSession>();
    const pool = new TelegramSessionPool({
      sessionFactory: async (userId) => {
        const s = new FakeAgentSession();
        sessions.set(userId, s);
        return s as unknown as AgentSession;
      },
    });
    return { pool, sessions };
  }

  it("creates one isolated session per user", async () => {
    const { pool, sessions } = makePool();
    const a = await pool.handleMessage(1, undefined, "привет");
    const b = await pool.handleMessage(2, undefined, "hi");
    assert.equal(a.text, "ответ на: привет");
    assert.equal(b.text, "ответ на: hi");
    assert.equal(pool.activeCount(), 2);
    assert.equal(sessions.size, 2);
    assert.deepEqual(sessions.get(1)!.prompts, ["привет"]);
    assert.deepEqual(sessions.get(2)!.prompts, ["hi"]);
  });

  it("reuses the same session for the same user", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage(1, undefined, "первое");
    await pool.handleMessage(1, undefined, "второе");
    assert.equal(sessions.size, 1);
    assert.deepEqual(sessions.get(1)!.prompts, ["первое", "второе"]);
    assert.equal(pool.activeCount(), 1);
  });

  it("disposes all sessions on shutdown", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage(1, undefined, "x");
    await pool.handleMessage(2, undefined, "y");
    await pool.disposeAll();
    assert.equal(pool.activeCount(), 0);
    for (const s of sessions.values()) assert.equal(s.disposed, true);
  });

  it("returns the pending file path from the session", async () => {
    const pool = new TelegramSessionPool({
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        s.pendingFile = "/tmp/report.pdf";
        return s as unknown as AgentSession;
      },
    });
    const reply = await pool.handleMessage(1, undefined, "отчёт");
    assert.equal(reply.text, "ответ на: отчёт");
    assert.equal(reply.filePath, "/tmp/report.pdf");
  });

  it("returns no filePath when nothing was generated", async () => {
    const { pool } = makePool();
    const reply = await pool.handleMessage(1, undefined, "привет");
    assert.equal(reply.filePath, undefined);
  });
});
