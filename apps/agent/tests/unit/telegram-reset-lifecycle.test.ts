/**
 * PROMPT 3: lifecycle race между TelegramSessionPool.reset() и running/queued work.
 *
 * Protocol (drain-then-dispose):
 *   reset отцепляет entry от пула СИНХРОННО → ждёт terminal state ВСЕХ
 *   принятых операций (queue) → только потом dispose. Не глобальный лок.
 *
 * Сценарии по runbook:
 *   A. reset когда queue idle;
 *   B. reset во время running prompt;
 *   C. reset когда есть queued prompts;
 *   D. reset + immediately incoming message (ключевой);
 *   E. два reset подряд;
 *   F. timeout + reset;
 *   G. error + reset.
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
  /** prompt эмитит agent_end автоматически (обычный ход). */
  autoEnd = true;
  /** Первый prompt висит (нет agent_end) — для watchdog-сценариев. */
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

  /** Ручной terminal event (controllable-сценарии). */
  emitAgentEnd(): void {
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [], willRetry: false });
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    this.promptCalls++;
    if (this.firstPromptFails && this.promptCalls === 1) {
      throw new Error("model down");
    }
    this.lastText = `ответ на: ${message}`;
    const hangs = this.firstPromptHangs && this.promptCalls === 1;
    if (!hangs && this.autoEnd) {
      this.emitAgentEnd();
    }
    // Промис хода не резолвится в тестах: для пула terminal state приходит
    // только через agent_end (как в реальном SDK — prompt без abort).
    return new Promise<never>(() => {});
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
  factory: (order: number) => FakeAgentSession,
  promptTimeoutMs?: number,
): { pool: TelegramSessionPool; created: FakeAgentSession[] } {
  const created: FakeAgentSession[] = [];
  const pool = new TelegramSessionPool({
    promptTimeoutMs,
    sessionFactory: async () => {
      const s = factory(created.length);
      created.push(s);
      return s as unknown as AgentSession;
    },
  });
  return { pool, created };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const KEY = "tg:1:1";

describe("telegram reset lifecycle (PROMPT 3)", () => {
  it("A. reset при idle-очереди: dispose и новая сессия", async () => {
    const { pool, created } = makePool(() => new FakeAgentSession());
    await pool.handleMessage(KEY, 1, "первое", { chatId: "1" });
    const first = created[0];

    await pool.reset(KEY);
    assert.equal(first.disposed, true, "idle: dispose сразу после reset");

    await pool.handleMessage(KEY, 1, "второе", { chatId: "1" });
    assert.equal(created.length, 2, "следующее сообщение — новая session");
    assert.deepEqual(created[1].prompts, ["второе"]);
    assert.equal(pool.activeCount(), 1);
  });

  it("B. reset во время running prompt: dispose только после terminal state", async () => {
    const { pool, created } = makePool(() => {
      const s = new FakeAgentSession();
      s.autoEnd = false; // ход контролируем вручную
      return s;
    });
    const aPromise = pool.handleMessage(KEY, 1, "A", { chatId: "1" });
    await sleep(0);
    const first = created[0];
    assert.deepEqual(first.prompts, ["A"], "A запущен");

    const resetPromise = pool.reset(KEY);
    assert.equal(first.disposed, false, "reset НЕ dispose посреди активного хода");
    assert.equal(pool.activeCount(), 0, "entry отцеплена сразу (новые операции не принимаются)");

    first.emitAgentEnd();
    const a = await aPromise;
    assert.equal(a.text, "ответ на: A", "ход A завершился корректно");

    await resetPromise;
    assert.equal(first.disposed, true, "dispose только после terminal state");
  });

  it("C. reset с queued prompts: принятые ходы дорабатывают на живой сессии", async () => {
    const { pool, created } = makePool(() => {
      const s = new FakeAgentSession();
      s.autoEnd = false;
      return s;
    });
    const aPromise = pool.handleMessage(KEY, 1, "A", { chatId: "1" });
    const c1Promise = pool.handleMessage(KEY, 1, "C1", { chatId: "1" });
    const c2Promise = pool.handleMessage(KEY, 1, "C2", { chatId: "1" });
    await sleep(0);
    const first = created[0];
    assert.deepEqual(first.prompts, ["A"], "queued-ходы ещё не стартовали");

    const resetPromise = pool.reset(KEY);
    first.emitAgentEnd();
    await sleep(0);
    assert.deepEqual(first.prompts, ["A", "C1"], "C1 выполняется на старой сессии");
    assert.equal(first.disposed, false);
    first.emitAgentEnd();
    await sleep(0);
    assert.deepEqual(first.prompts, ["A", "C1", "C2"], "C2 выполняется на старой сессии");
    assert.equal(first.disposed, false);
    first.emitAgentEnd();

    await resetPromise;
    assert.equal(first.disposed, true, "dispose после ВСЕХ принятых ходов");
    assert.deepEqual(
      [(await aPromise).text, (await c1Promise).text, (await c2Promise).text],
      ["ответ на: A", "ответ на: C1", "ответ на: C2"],
      "ответы всех принятых ходов доставлены",
    );
    assert.equal(pool.activeCount(), 0);
  });

  it("D. running A → reset → incoming B: B в новой session, A не трогает disposed", async () => {
    const { pool, created } = makePool((order) => {
      const s = new FakeAgentSession();
      if (order === 0) s.autoEnd = false; // первая (A) — controllable
      return s;
    });
    const aPromise = pool.handleMessage(KEY, 1, "A", { chatId: "1" });
    await sleep(0);
    const first = created[0];

    const resetPromise = pool.reset(KEY);
    // B приходит СРАЗУ после reset.
    const bPromise = pool.handleMessage(KEY, 1, "B", { chatId: "1" });
    await sleep(0);

    assert.equal(created.length, 2, "B работает в НОВОЙ session");
    const second = created[1];
    assert.deepEqual(second.prompts, ["B"]);
    assert.equal(first.disposed, false, "A ещё работает — старая session жива");

    const b = await bPromise;
    assert.equal(b.text, "ответ на: B");
    assert.equal(second.disposed, false, "новая session не трогается reset'ом");

    // A завершается: НЕ использует disposed runtime (dispose ещё не было).
    first.emitAgentEnd();
    const a = await aPromise;
    assert.equal(a.text, "ответ на: A");

    await resetPromise;
    assert.equal(first.disposed, true, "старая session закрыта после A");
    assert.equal(second.disposed, false, "новая session жива");
    assert.equal(pool.activeCount(), 1);
  });

  it("E. два reset подряд: второй — no-op без ошибок", async () => {
    const { pool, created } = makePool(() => new FakeAgentSession());
    await pool.handleMessage(KEY, 1, "первое", { chatId: "1" });
    const first = created[0];

    await pool.reset(KEY);
    await pool.reset(KEY); // второй — должен просто выйти
    assert.equal(first.disposed, true);

    await pool.reset("tg:unknown"); // неизвестный ключ — тоже no-op
    assert.equal(pool.activeCount(), 0);
  });

  it("F. timeout + reset: reset ждёт watchdog, затем dispose", async () => {
    const { pool, created } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptHangs = true;
      return s;
    }, 20);
    const aPromise = pool.handleMessage(KEY, 1, "висит", { chatId: "1" });
    await sleep(0);
    const first = created[0];

    const resetPromise = pool.reset(KEY);
    assert.equal(first.disposed, false, "reset ждёт terminal state (watchdog)");

    const a = await aPromise;
    assert.equal(a.text, PROMPT_TIMEOUT_MESSAGE);

    await resetPromise;
    assert.equal(first.disposed, true);
  });

  it("G. error + reset: reset ждёт ERROR-terminal, затем dispose", async () => {
    const { pool, created } = makePool(() => {
      const s = new FakeAgentSession();
      s.firstPromptFails = true;
      return s;
    });
    const aPromise = pool.handleMessage(KEY, 1, "сбой", { chatId: "1" });
    const resetPromise = pool.reset(KEY);
    const first = created[0];

    const a = await aPromise;
    assert.equal(a.text, "Не удалось получить ответ от Гриши.");

    await resetPromise;
    assert.equal(first.disposed, true, "dispose после ERROR-terminal");
  });
});
