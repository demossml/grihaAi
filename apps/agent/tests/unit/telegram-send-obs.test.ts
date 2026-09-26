/**
 * P1 — наблюдаемость отправки текста: тихие сбои доставки теперь emit-ятся
 * (telegram.send.reply ok:false), а не только пишутся в console.error.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initObs, resetObsForTests } from "@griha/observability";
import type { ObsEvent, ObsSink } from "@griha/observability";
import {
  TelegramBotController,
  type TelegramBotLike,
  type TelegramBotControllerOptions,
} from "../../.pi/extensions/telegram-bot/TelegramBotController.js";

class FakeBot implements TelegramBotLike {
  handler: ((ctx: unknown) => unknown) | null = null;
  callbackHandler: ((ctx: unknown) => unknown) | null = null;
  sendError: unknown = { error_code: 403, description: "Forbidden: bot was kicked" };
  sendCalls = 0;
  sent: Array<{ chatId: number; text: string }> = [];

  on(
    filter:
      | "message"
      | "channel_post"
      | "edited_message"
      | "edited_channel_post"
      | "callback_query:data"
      | "my_chat_member"
      | "chat_join_request",
    handler: (ctx: unknown) => unknown,
  ): void {
    if (
      filter === "message" ||
      filter === "channel_post" ||
      filter === "edited_message" ||
      filter === "edited_channel_post"
    ) {
      this.handler = handler;
    } else if (filter === "callback_query:data") this.callbackHandler = handler;
  }

  async start(): Promise<unknown> {
    return undefined;
  }
  async stop(): Promise<unknown> {
    return undefined;
  }

  api = {
    sendMessage: async (
      _chatId: number,
      _text: string,
      _extra?: { parseMode?: "HTML"; inlineButtons?: unknown; messageThreadId?: number },
    ): Promise<unknown> => {
      this.sendCalls++;
      throw this.sendError;
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
    getChatMember: async (
      _chatId: number,
      _userId: number,
    ): Promise<{ status: string }> => ({ status: "member" }),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const update = {
  update: { update_id: 1 },
  message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
};

function makeController(fake: FakeBot, options?: TelegramBotControllerOptions): TelegramBotController {
  return new TelegramBotController(
    async () => ({ text: "ответ" }),
    [123],
    () => fake,
    { reconnectDelayMs: 1, sleep: () => Promise.resolve(), ...options },
  );
}

let captured: ObsEvent[] = [];
const sink: ObsSink = { write(e) { captured.push(e); } };

beforeEach(() => {
  // тест-скрипт ставит GRIHA_OBS=0; obs-тест явно включает emit.
  delete process.env.GRIHA_OBS;
  resetObsForTests();
  captured = [];
});

afterEach(() => {
  resetObsForTests();
  captured = [];
});

describe("telegram send obs (P1)", () => {
  it("провал отправки текста → emit telegram.send.reply ok:false (не только console.error)", async () => {
    initObs({ sink });
    const fake = new FakeBot();
    // 403 non-retryable → HTML и plain сразу падают.
    const c = makeController(fake, { sendRetry: { maxAttempts: 3, delayMs: () => 0 } });
    c.start("t");
    fake.handler?.(update);
    await tick();

    assert.ok(fake.sendCalls >= 1, "sendMessage вызывался");
    assert.equal(fake.sent.length, 0, "ничего не отправлено");

    const failEvents = captured.filter(
      (e) => e.component === "telegram.send" && e.event === "telegram.send.reply" && e.ok === false,
    );
    assert.ok(failEvents.length >= 1, "есть emit ok:false");
    assert.equal(failEvents[0].chatId, "999");
    assert.equal((failEvents[0].data as Record<string, unknown>).textOk, false);
    await c.stop();
  });

  it("успешная отправка → emit telegram.send.reply ok:true", async () => {
    initObs({ sink });
    const fake = new FakeBot();
    fake.sendError = undefined; // sendMessage больше не падает
    // переопределяем: при sendError undefined — успех
    fake.api.sendMessage = async (chatId: number, text: string) => {
      fake.sent.push({ chatId, text });
      return undefined;
    };
    const c = makeController(fake);
    c.start("t");
    fake.handler?.(update);
    await tick();

    assert.equal(fake.sent.length, 1);
    const okEvents = captured.filter(
      (e) => e.component === "telegram.send" && e.event === "telegram.send.reply" && e.ok === true,
    );
    assert.ok(okEvents.length >= 1, "есть emit ok:true");
    assert.equal(okEvents[0].chatId, "999");
    await c.stop();
  });
});
