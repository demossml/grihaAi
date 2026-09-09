import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { TelegramSessionPool } from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (event: unknown) => void;

class FakeAgentSession {
  listeners: Listener[] = [];
  prompts: string[] = [];
  lastText = "";
  disposed = false;
  sessionId = Math.random().toString(36).slice(2);

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    this.lastText = `ответ на: ${message}`;
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

describe("telegram /new reset", () => {
  it("pool.reset disposes the old session and creates a fresh one", async () => {
    const created: FakeAgentSession[] = [];
    const pool = new TelegramSessionPool({
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        created.push(s);
        return s as unknown as AgentSession;
      },
    });

    await pool.handleMessage("tg:1:1", 1, "первое", { chatId: "1" });
    assert.equal(created.length, 1);
    const first = created[0];
    assert.deepEqual(first.prompts, ["первое"]);

    await pool.reset("tg:1:1");
    assert.equal(first.disposed, true, "old session should be disposed");

    await pool.handleMessage("tg:1:1", 1, "второе", { chatId: "1" });
    assert.equal(created.length, 2, "a new session should be created");
    const second = created[1];
    assert.notEqual(second, first);
    assert.deepEqual(second.prompts, ["второе"]);
    assert.equal(pool.activeCount(), 1);
  });

  it("/new in the bridge triggers the reset handler with the session key", async () => {
    const resets: Array<{ sessionKey: string; userId: number; chatId: string }> = [];
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        resetHandler: (sessionKey, userId, chatId) => {
          resets.push({ sessionKey, userId, chatId });
        },
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "/new" },
    });

    assert.equal(res.handled, true);
    assert.deepEqual(resets, [{ sessionKey: "tg:123:999", userId: 123, chatId: "999" }]);
    assert.deepEqual(sent, ["Новая сессия начата."]);
  });
});
