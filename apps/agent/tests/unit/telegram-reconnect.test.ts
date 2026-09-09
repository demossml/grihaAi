import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelegramBotController,
  type TelegramBotLike,
  type TelegramBotControllerOptions,
} from "../../.pi/extensions/telegram-bot/TelegramBotController.js";

class FakeBot implements TelegramBotLike {
  handler: ((ctx: unknown) => unknown) | null = null;
  callbackHandler: ((ctx: unknown) => unknown) | null = null;
  started = 0;
  stopped = 0;
  /** Сколько раз start() падает, прежде чем «подняться» (заблокироваться до stop()). */
  startRejections = 0;
  /** Сколько раз sendMessage падает, прежде чем успешно отправить. */
  sendFailures = 0;
  sendCalls = 0;
  sent: Array<{ chatId: number; text: string }> = [];
  private stopResolve: (() => void) | null = null;

  on(
    filter: "message" | "callback_query:data" | "my_chat_member",
    handler: (ctx: unknown) => unknown,
  ): void {
    if (filter === "message") this.handler = handler;
    else if (filter === "callback_query:data") this.callbackHandler = handler;
  }

  async start(): Promise<unknown> {
    this.started++;
    if (this.startRejections > 0) {
      this.startRejections--;
      throw new Error("polling failed (network)");
    }
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
    sendMessage: async (
      chatId: number,
      text: string,
      _extra?: { parseMode?: "HTML"; inlineButtons?: unknown; messageThreadId?: number },
    ): Promise<unknown> => {
      this.sendCalls++;
      if (this.sendFailures > 0) {
        this.sendFailures--;
        throw new Error("502 Bad Gateway");
      }
      this.sent.push({ chatId, text });
      return undefined;
    },
    sendDocument: async (
      _chatId: number,
      _filePath: string,
      _extra?: { caption?: string },
    ): Promise<unknown> => undefined,
    sendChatAction: async (_chatId: number, _action: "typing" | "upload_document"): Promise<unknown> =>
      undefined,
    setMyCommands: async (
      _commands: Array<{ command: string; description: string }>,
    ): Promise<unknown> => undefined,
    setMessageReaction: async (
      _chatId: number,
      _messageId: number,
      _reaction: string,
    ): Promise<unknown> => undefined,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const update = {
  update: { update_id: 1 },
  message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
};

function makeController(fake: FakeBot, options?: TelegramBotControllerOptions) {
  return new TelegramBotController(
    async () => ({ text: "ответ" }),
    [123],
    () => fake,
    { reconnectDelayMs: 1, sleep: () => Promise.resolve(), ...options },
  );
}

describe("telegram sendWithRetry (через публичный путь сообщения)", () => {
  it("успех с первой попытки", async () => {
    const fake = new FakeBot();
    const c = makeController(fake);
    c.start("t");
    fake.handler?.(update);
    await tick();
    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0].text, "ответ");
    assert.equal(fake.sendCalls, 1);
    await c.stop();
  });

  it("успех после двух неудач (3 попытки)", async () => {
    const fake = new FakeBot();
    fake.sendFailures = 2;
    const c = makeController(fake, { sendRetry: { maxAttempts: 5, delayMs: () => 0 } });
    c.start("t");
    fake.handler?.(update);
    await tick();
    assert.equal(fake.sendCalls, 3);
    assert.equal(fake.sent.length, 1);
    await c.stop();
  });

  it("отказ после maxAttempts — без бесконечного цикла и без исключения", async () => {
    const fake = new FakeBot();
    fake.sendFailures = 99;
    const c = makeController(fake, { sendRetry: { maxAttempts: 3, delayMs: () => 0 } });
    c.start("t");
    fake.handler?.(update);
    await tick();
    assert.equal(fake.sendCalls, 3);
    assert.equal(fake.sent.length, 0);
    await c.stop();
  });

  it("корректная нарастающая пауза", async () => {
    const fake = new FakeBot();
    fake.sendFailures = 1;
    const delays: number[] = [];
    const c = makeController(fake, {
      sendRetry: { maxAttempts: 5, delayMs: (a) => a * 10 },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    c.start("t");
    fake.handler?.(update);
    await tick();
    assert.deepEqual(delays, [10]);
    assert.equal(fake.sent.length, 1);
    await c.stop();
  });
});

describe("telegram pollLoop (reconnect)", () => {
  it("при сбое start() бот пересоздаётся и пробует снова", async () => {
    const fake = new FakeBot();
    fake.startRejections = 2;
    const c = makeController(fake);
    c.start("t");
    for (let i = 0; i < 10; i++) await tick();
    assert.ok(fake.started >= 3, `expected >=3 start attempts, got ${fake.started}`);
    assert.equal(c.isRunning(), true);
    await c.stop();
  });

  it("stop() корректно выходит из цикла", async () => {
    const fake = new FakeBot();
    const c = makeController(fake);
    c.start("t");
    await tick();
    assert.equal(fake.started, 1);
    assert.equal(c.isRunning(), true);
    await c.stop();
    assert.equal(fake.stopped, 1);
    assert.equal(c.isRunning(), false);
  });
});
