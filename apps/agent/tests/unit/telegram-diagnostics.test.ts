/**
 * PROMPT 4: структурированная техническая диагностика Telegram-пути.
 *
 * Инварианты:
 *  - error не теряется (diag-строка содержит operation/stage/error);
 *  - пользователь по-прежнему получает безопасное сообщение;
 *  - logging сам не может бросить (hostile error-объекты);
 *  - пользовательский текст/транскрипты НЕ попадают в лог.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTelegramError,
  logTelegramError,
} from "../../.pi/extensions/telegram-bot/telegram-diagnostics.js";
import {
  TelegramSessionPool,
  PROMPT_TIMEOUT_MESSAGE,
} from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import { startTypingHeartbeat } from "../../.pi/extensions/telegram-bot/typing-heartbeat.js";
import { assertCanConfigureGroup } from "../../.pi/extensions/telegram-bot/chat-auth.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (event: unknown) => void;

class FakeAgentSession {
  listeners: Listener[] = [];
  lastText = "";
  sessionId = Math.random().toString(36).slice(2);
  firstPromptFails = false;
  firstPromptHangs = false;
  private promptCalls = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.promptCalls++;
    if (this.firstPromptFails && this.promptCalls === 1) {
      throw new Error("model down");
    }
    if (this.firstPromptHangs && this.promptCalls === 1) {
      return new Promise<never>(() => {});
    }
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
    /* noop */
  }
}

/** Перехват console.error для проверки diag-строк. */
function captureConsoleError(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.error;
  return {
    lines,
    restore: () => {
      console.error = orig;
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("telegram diagnostics helper (PROMPT 4)", () => {
  it("1. logTelegramError пишет одну JSON-строку со всеми полями и не бросает", () => {
    const { lines, restore } = captureConsoleError();
    try {
      logTelegramError({
        operation: "agent_prompt",
        stage: "prompt",
        sessionId: "sess-1",
        chatId: 42,
        userId: 7,
        threadId: 3,
        error: new TypeError("boom"),
        detail: "kind=network",
      });
      assert.equal(lines.length, 1);
      const line = lines[0]!;
      assert.ok(line.includes("[telegram-bot] diag "));
      assert.ok(line.includes('"operation":"agent_prompt"'));
      assert.ok(line.includes('"stage":"prompt"'));
      assert.ok(line.includes('"sessionId":"sess-1"'));
      assert.ok(line.includes('"chatId":42'));
      assert.ok(line.includes('"userId":7'));
      assert.ok(line.includes('"threadId":3'));
      assert.ok(line.includes('"error":"TypeError: boom"'));
      assert.ok(line.includes('"detail":"kind=network"'));
    } finally {
      restore();
    }
  });

  it("2. logging не бросает на hostile error-объектах", () => {
    const { lines, restore } = captureConsoleError();
    try {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const throwingToString: unknown = {
        toString(): string {
          throw new Error("toString boom");
        },
      };
      assert.doesNotThrow(() => {
        logTelegramError({ operation: "x", error: circular });
        logTelegramError({ operation: "y", error: throwingToString });
        logTelegramError({ operation: "z", error: Symbol("sym") });
      });
      assert.ok(lines.every((l) => l.includes("[telegram-bot] diag ")));
    } finally {
      restore();
    }
  });

  it("3. formatTelegramError: Error → Name: message, остальное — String()", () => {
    assert.equal(formatTelegramError(new Error("boom")), "Error: boom");
    assert.equal(formatTelegramError("plain"), "plain");
    assert.equal(formatTelegramError(42), "42");
    assert.equal(formatTelegramError(undefined), "undefined");
    assert.equal(formatTelegramError(null), "null");
    const bad = {
      toString(): string {
        throw new Error("nope");
      },
    };
    assert.equal(formatTelegramError(bad), "[unserializable error]");
  });
});

describe("telegram diagnostics integration (PROMPT 4)", () => {
  it("4. runPrompt prompt-error: diag с операцией/сессией/чатом, БЕЗ текста пользователя", async () => {
    const { lines, restore } = captureConsoleError();
    try {
      const session = new FakeAgentSession();
      session.firstPromptFails = true;
      const pool = new TelegramSessionPool({
        sessionFactory: async () => session as unknown as AgentSession,
      });
      const reply = await pool.handleMessage("tg:7:42", 7, "СЕКРЕТНЫЙ ТЕКСТ ПОЛЬЗОВАТЕЛЯ", {
        chatId: "42",
      });
      assert.equal(reply.text, "Не удалось получить ответ от Гриши.");
      const diag = lines.filter((l) => l.includes("diag"));
      const promptLine = diag.find((l) => l.includes('"stage":"prompt"'));
      assert.ok(promptLine, "diag-строка prompt-error есть");
      assert.ok(promptLine!.includes('"operation":"agent_prompt"'));
      assert.ok(promptLine!.includes(`"sessionId":"${session.sessionId}"`));
      assert.ok(promptLine!.includes('"chatId":"42"'));
      assert.ok(promptLine!.includes('"userId":"7"'));
      assert.ok(promptLine!.includes('"error":"Error: model down"'));
      // Пользовательский текст не должен попадать в лог.
      assert.ok(
        lines.every((l) => !l.includes("СЕКРЕТНЫЙ ТЕКСТ")),
        "пользовательский текст не логируется",
      );
    } finally {
      restore();
    }
  });

  it("5. watchdog: diag stage=watchdog, БЕЗ текста пользователя", async () => {
    const { lines, restore } = captureConsoleError();
    try {
      const session = new FakeAgentSession();
      session.firstPromptHangs = true;
      const pool = new TelegramSessionPool({
        promptTimeoutMs: 20,
        sessionFactory: async () => session as unknown as AgentSession,
      });
      const reply = await pool.handleMessage("tg:7:42", 7, "ЗАВИСШЕЕ СООБЩЕНИЕ", {
        chatId: "42",
      });
      assert.equal(reply.text, PROMPT_TIMEOUT_MESSAGE);
      const watchdog = lines.find(
        (l) => l.includes("diag") && l.includes('"stage":"watchdog"'),
      );
      assert.ok(watchdog, "diag watchdog есть");
      assert.ok(watchdog!.includes('"operation":"agent_prompt"'));
      assert.ok(watchdog!.includes(`"sessionId":"${session.sessionId}"`));
      assert.ok(lines.every((l) => !l.includes("ЗАВИСШЕЕ СООБЩЕНИЕ")));
    } finally {
      restore();
    }
  });

  it("6. reset drain-failure: rejection очереди логируется, reset не бросает", async () => {
    const { lines, restore } = captureConsoleError();
    try {
      const pool = new TelegramSessionPool({
        sessionFactory: async () => {
          throw new Error("factory boom");
        },
      });
      const p = pool.handleMessage("tg:1:1", 1, "x", { chatId: "1" });
      await p.catch(() => undefined);
      await assert.doesNotReject(() => pool.reset("tg:1:1"));
      const drain = lines.find(
        (l) => l.includes("diag") && l.includes('"stage":"drain"'),
      );
      assert.ok(drain, "diag drain есть");
      assert.ok(drain!.includes('"operation":"reset"'));
      assert.ok(drain!.includes('"error":"Error: factory boom"'));
    } finally {
      restore();
    }
  });

  it("7. typing heartbeat: логируется только ПЕРВАЯ ошибка пульса", async () => {
    const { lines, restore } = captureConsoleError();
    try {
      const hb = startTypingHeartbeat(42, undefined, {
        intervalMs: 1,
        sendChatAction: async () => {
          throw new Error("bot kicked");
        },
      });
      await sleep(15); // несколько пульсов
      await hb.stop();
      const diag = lines.filter(
        (l) => l.includes("diag") && l.includes('"operation":"typing_heartbeat"'),
      );
      assert.equal(diag.length, 1, "ровно одна diag-строка (без спама)");
      assert.ok(diag[0]!.includes('"chatId":42'));
      assert.ok(diag[0]!.includes('"error":"Error: bot kicked"'));
    } finally {
      restore();
    }
  });

  it("8. chat-auth: сбой getChatMember логируется, семантика fail-closed сохранена", async () => {
    const { lines, restore } = captureConsoleError();
    try {
      const res = await assertCanConfigureGroup({
        chatId: "42",
        userId: "7",
        getChatMember: async () => {
          throw new Error("network down");
        },
        users: { canManage: async () => true },
      });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "Не удалось проверить права, попробуйте позже.");
      const diag = lines.find(
        (l) => l.includes("diag") && l.includes('"operation":"chat_auth_get_chat_member"'),
      );
      assert.ok(diag, "diag есть");
      assert.ok(diag!.includes('"chatId":"42"'));
      assert.ok(diag!.includes('"userId":"7"'));
      assert.ok(diag!.includes('"error":"Error: network down"'));
      // parseTelegramError классифицирует сетевую ошибку как retryable.
      assert.ok(diag!.includes('"detail":"kind=retryable"'));
    } finally {
      restore();
    }
  });
});
