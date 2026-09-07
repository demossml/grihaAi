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
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "../../src/utils/config.js";
import type { GrishAiConfig } from "../../src/types/config.js";

describe("telegram bridge", () => {
  it("parses a text update and routes it to the agent", async () => {
    const calls: Array<{ message: string; userId: number; sessionKey: string }> = [];
    const sent: Array<{ chatId: number; text: string }> = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push({ message: input.message, userId: input.userId, sessionKey: input.sessionKey });
        return "ответ Гриши";
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
        return "x";
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
    const bridge = new TelegramBridge([123], async () => "x", async (_chatId, text) => {
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
});

class FakeBot implements TelegramBotLike {
  started = 0;
  stopped = 0;
  handler: ((ctx: unknown) => unknown) | null = null;

  on(_filter: "message", handler: (ctx: unknown) => unknown): void {
    this.handler = handler;
  }

  async start(): Promise<unknown> {
    this.started++;
    return undefined;
  }

  async stop(): Promise<unknown> {
    this.stopped++;
    return undefined;
  }

  api = {
    sendMessage: async (_chatId: number, _text: string): Promise<unknown> => undefined,
  };
}

describe("telegram bot controller", () => {
  it("starts and stops long polling", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => "x", [123], () => fake);

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
    const controller = new TelegramBotController(async () => "x", [123], () => fake);
    controller.start("token");
    controller.start("token");
    assert.equal(fake.started, 1);
  });
});

class FakeAgentSession {
  listeners: Array<(event: unknown) => void> = [];
  prompts: string[] = [];
  lastText = "";
  disposed = false;

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
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
    const a = await pool.handleMessage(1, "привет");
    const b = await pool.handleMessage(2, "hi");
    assert.equal(a, "ответ на: привет");
    assert.equal(b, "ответ на: hi");
    assert.equal(pool.activeCount(), 2);
    assert.equal(sessions.size, 2);
    assert.deepEqual(sessions.get(1)!.prompts, ["привет"]);
    assert.deepEqual(sessions.get(2)!.prompts, ["hi"]);
  });

  it("reuses the same session for the same user", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage(1, "первое");
    await pool.handleMessage(1, "второе");
    assert.equal(sessions.size, 1);
    assert.deepEqual(sessions.get(1)!.prompts, ["первое", "второе"]);
    assert.equal(pool.activeCount(), 1);
  });

  it("disposes all sessions on shutdown", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage(1, "x");
    await pool.handleMessage(2, "y");
    await pool.disposeAll();
    assert.equal(pool.activeCount(), 0);
    for (const s of sessions.values()) assert.equal(s.disposed, true);
  });
});
