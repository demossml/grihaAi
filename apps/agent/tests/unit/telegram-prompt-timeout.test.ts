/**
 * PROMPT 2: watchdog/timeout для TelegramSessionPool.runPrompt().
 *
 * Terminal state machine: SUCCESS (agent_end) / ERROR (prompt error) /
 * TIMEOUT (watchdog). Инварианты: cleanup ровно один раз, finish ровно один
 * раз, очередь освобождается, следующее сообщение выполняется.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelegramSessionPool,
  PROMPT_TIMEOUT_MESSAGE,
} from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (event: unknown) => void;

class FakeAgentSession {
  listeners: Listener[] = [];
  prompts: string[] = [];
  lastText = "";
  disposed = false;
  sessionId = Math.random().toString(36).slice(2);
  /** Первый prompt висит (не резолвится, agent_end не эмитится). */
  firstPromptHangs = false;
  /** Первый prompt кидает ошибку. */
  firstPromptFails = false;
  private promptCalls = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Ручной terminal event (для сценариев late agent_end). */
  emitAgentEnd(): void {
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [], willRetry: false });
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    this.promptCalls++;
    if (this.firstPromptFails && this.promptCalls === 1) {
      throw new Error("model down");
    }
    if (this.firstPromptHangs && this.promptCalls === 1) {
      return new Promise<never>(() => {});
    }
    this.lastText = `ответ на: ${message}`;
    this.emitAgentEnd();
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

function makePool(
  factory: (key: string) => FakeAgentSession,
  promptTimeoutMs?: number,
): { pool: TelegramSessionPool; sessions: Map<string, FakeAgentSession> } {
  const sessions = new Map<string, FakeAgentSession>();
  const pool = new TelegramSessionPool({
    promptTimeoutMs,
    sessionFactory: async (key) => {
      const s = factory(key);
      sessions.set(key, s);
      return s as unknown as AgentSession;
    },
  });
  return { pool, sessions };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("telegram runPrompt watchdog (PROMPT 2)", () => {
  it("1. normal agent_end resolves normally", async () => {
    const { pool, sessions } = makePool(() => new FakeAgentSession());
    const reply = await pool.handleMessage("tg:1:1", 1, "привет", { chatId: "1" });
    assert.equal(reply.text, "ответ на: привет");
    assert.equal(sessions.get("tg:1:1")!.listeners.length, 0, "listener снят");
  });

  it("2. prompt error resolves с ERROR-ответом и чистит listener", async () => {
    const { pool, sessions } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptFails = true;
      return s;
    });
    const reply = await pool.handleMessage("tg:1:1", 1, "привет", { chatId: "1" });
    assert.equal(reply.text, "Не удалось получить ответ от Гриши.");
    assert.equal(sessions.get("tg:1:1")!.listeners.length, 0);
  });

  it("3. timeout terminates runPrompt (watchdog)", async () => {
    const { pool } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptHangs = true;
      return s;
    }, 30);
    const reply = await pool.handleMessage("tg:1:1", 1, "висит", { chatId: "1" });
    assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);
  });

  it("4. timeout cleans listener", async () => {
    const { pool, sessions } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptHangs = true;
      return s;
    }, 20);
    await pool.handleMessage("tg:1:1", 1, "висит", { chatId: "1" });
    assert.equal(sessions.get("tg:1:1")!.listeners.length, 0);
  });

  it("5. finish exactly once: late agent_end после TIMEOUT не меняет ответ", async () => {
    const { pool, sessions } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptHangs = true;
      return s;
    }, 20);
    const reply = await pool.handleMessage("tg:1:1", 1, "висит", { chatId: "1" });
    assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);
    // Late event — listener уже снят, finish уже сработал.
    sessions.get("tg:1:1")!.lastText = "поздний ответ";
    sessions.get("tg:1:1")!.emitAgentEnd();
    await sleep(10);
    assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE, "ответ не меняется");
  });

  it("6. after timeout session is recycled: B runs on a NEW session", async () => {
    const created: FakeAgentSession[] = [];
    const pool = new TelegramSessionPool({
      promptTimeoutMs: 20,
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        // Висит только ПЕРВАЯ сессия (до recycle); новая — нормально отвечает.
        s.firstPromptHangs = created.length === 0;
        created.push(s);
        return s as unknown as AgentSession;
      },
    });
    const a = await pool.handleMessage("tg:1:1", 1, "A висит", { chatId: "1" });
    assert.equal(a.text, PROMPT_TIMEOUT_MESSAGE);

    const b = await pool.handleMessage("tg:1:1", 1, "B после", { chatId: "1" });
    assert.equal(b.text, "ответ на: B после");

    assert.equal(created.length, 2, "после timeout создаётся новая сессия");
    assert.equal(created[0].disposed, true, "старая (зависшая) сессия dispose");
    assert.equal(created[1].disposed, false);
    assert.deepEqual(created[1].prompts, ["B после"], "B выполняется на новой сессии");
  });

  it("7. SUCCESS-путь не ломается поздним watchdog (timer сброшен)", async () => {
    const { pool } = makePool(() => new FakeAgentSession(), 25);
    const reply = await pool.handleMessage("tg:1:1", 1, "быстро", { chatId: "1" });
    assert.equal(reply.text, "ответ на: быстро");
    await sleep(60);
    assert.equal(reply.text, "ответ на: быстро", "таймаут не перезаписал ответ");
  });

  it("8. два сообщения: hang A → timeout, B в другой чат не блокируется", async () => {
    let created = 0;
    const { pool } = makePool(() => {
      const s = new FakeAgentSession();
      // Висит только первый prompt ПЕРВОЙ сессии (чат 1); чат 2 — normal.
      if (created === 0) s.firstPromptHangs = true;
      created++;
      return s;
    }, 20);
    // Запускаем A (висит) и сразу B в ДРУГОЙ session key (другой чат).
    const aPromise = pool.handleMessage("tg:1:1", 1, "A висит", { chatId: "1" });
    const b = await pool.handleMessage("tg:2:2", 2, "B другой чат", { chatId: "2" });
    assert.equal(b.text, "ответ на: B другой чат");
    const a = await aPromise;
    assert.equal(a.text, PROMPT_TIMEOUT_MESSAGE);
  });

  it("9. recycle removes pool entry and finish settles once (PROMPT 7)", async () => {
    const created: FakeAgentSession[] = [];
    const pool = new TelegramSessionPool({
      promptTimeoutMs: 15,
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        s.firstPromptHangs = true;
        created.push(s);
        return s as unknown as AgentSession;
      },
    });

    const reply = await pool.handleMessage("tg:1:1", 1, "висит", { chatId: "1" });
    assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);

    // Entry убран из пула → activeCount 0; сессия dispose.
    assert.equal(pool.activeCount(), 0, "зависшая entry удалена из пула");
    assert.equal(created[0].disposed, true);

    // Late agent_end не меняет ответ (settled-guard) и не «воскрешает» entry.
    created[0].lastText = "поздний ответ";
    created[0].emitAgentEnd();
    await sleep(10);
    assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);
    assert.equal(pool.activeCount(), 0, "entry не вернулась");
  });
});
