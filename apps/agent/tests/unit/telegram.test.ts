import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TelegramBridge,
  formatTelegramHtml,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import {
  TelegramBotController,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  splitTelegramText,
  type TelegramBotLike,
  type TelegramCallbackQueryContext,
  type TelegramChatMemberEvent,
} from "../../.pi/extensions/telegram-bot/TelegramBotController.js";
import { TelegramSessionPool } from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import {
  addSessionInlineButtons,
  setSessionFile,
  type InlineButton,
} from "../../src/utils/telegram/session-files.js";
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
    assert.equal(calls[0].sessionKey, "tg:123:999");
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

  it("ACL deny before agent: private chat gets a short denial, agent not called", async () => {
    let agentCalled = false;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      { aclCheck: async () => false },
    );

    const res = await bridge.handleUpdate({
      updateId: 20,
      message: { from: { id: 999 }, chat: { id: 1, type: "private" }, text: "привет" },
    });

    assert.equal(res.handled, true);
    assert.equal(res.reason, "acl-denied");
    assert.equal(agentCalled, false, "неизвестный не должен доходить до агента/LLM");
    assert.deepEqual(sent, ["Нет доступа."]);
  });

  it("ACL deny in a group is silent", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      { aclCheck: async () => false },
    );

    const res = await bridge.handleUpdate({
      updateId: 21,
      message: { from: { id: 999 }, chat: { id: -100, type: "group" }, text: "hi" },
    });

    assert.equal(res.reason, "acl-denied");
    assert.equal(sent.length, 0, "в группах — молча, без спама");
  });

  it("ACL allowed → normal agent flow", async () => {
    let agentCalled = false;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "ok" };
      },
      async () => {},
      { aclCheck: async () => true },
    );

    const res = await bridge.handleUpdate({
      updateId: 22,
      message: { from: { id: 999 }, chat: { id: 1 }, text: "привет" },
    });

    assert.equal(res.handled, true);
    assert.equal(agentCalled, true);
  });

  it("routes /users commands to the handler without calling the agent", async () => {
    let agentCalled = false;
    const handled: Array<{ args: string; userId: string }> = [];
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        usersCommandHandler: async (args, ctx) => {
          handled.push({ args, userId: ctx.userId });
          return `OK: user ${args.split(/\s+/)[1] ?? "?"} role=user`;
        },
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 23,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "/users add 111222333" },
    });

    assert.equal(res.handled, true);
    assert.deepEqual(handled, [{ args: "add 111222333", userId: "123" }]);
    assert.equal(agentCalled, false, "команда работает без LLM");
    assert.equal(sent[0], "OK: user 111222333 role=user");
  });

  it("routes contact messages to the agent and reacts 👍 on the original message", async () => {
    const calls: string[] = [];
    const reactions: Array<{ chatId: number; messageId: number; emoji: string }> = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push(input.message);
        return { text: "Контакт сохранён" };
      },
      async () => {},
      { react: (chatId, messageId, emoji) => reactions.push({ chatId, messageId, emoji }) },
    );

    const res = await bridge.handleUpdate({
      updateId: 11,
      message: {
        from: { id: 123 },
        chat: { id: 999 },
        messageId: 77,
        contact: { first_name: "Иван", last_name: "Петров", phone_number: "+79990001122" },
      },
    });

    assert.equal(res.handled, true);
    assert.ok(calls[0].includes("Пользователь поделился контактом."));
    assert.ok(calls[0].includes("Имя: Иван Петров"));
    assert.ok(calls[0].includes("Телефон: +79990001122"));
    assert.deepEqual(reactions, [{ chatId: 999, messageId: 77, emoji: "👍" }]);
  });

  it("routes contact messages without a react hook (no crash, agent still called)", async () => {
    const calls: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push(input.message);
        return { text: "ok" };
      },
      async () => {},
    );
    const res = await bridge.handleUpdate({
      updateId: 12,
      message: {
        from: { id: 123 },
        chat: { id: 999 },
        messageId: 78,
        contact: { first_name: "Мария" },
      },
    });
    assert.equal(res.handled, true);
    assert.ok(calls[0].includes("Имя: Мария"));
  });

  it("routes location messages to the agent (no reaction)", async () => {
    const calls: string[] = [];
    const reactions: unknown[] = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push(input.message);
        return { text: "ok" };
      },
      async () => {},
      { react: (...args) => reactions.push(args) },
    );

    const res = await bridge.handleUpdate({
      updateId: 13,
      message: {
        from: { id: 123 },
        chat: { id: 999 },
        messageId: 79,
        location: { latitude: 55.7558, longitude: 37.6173 },
      },
    });

    assert.equal(res.handled, true);
    assert.ok(calls[0].includes("Пользователь поделился геолокацией: 55.7558, 37.6173"));
    assert.equal(reactions.length, 0, "геолокация — без реакции, ответ приходит текстом");
  });

  it("routes voice messages through STT to the agent", async () => {
    const calls: Array<{ message: string; sessionKey: string }> = [];
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        calls.push({ message: input.message, sessionKey: input.sessionKey });
        return { text: "транскрипция: ..." };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      { transcribeVoice: async () => "послушай это сообщение" },
    );

    const res = await bridge.handleUpdate({
      updateId: 10,
      message: {
        from: { id: 123 },
        chat: { id: 999 },
        voice: { file_id: "voice-file-1" },
        caption: "послушай",
      },
    });

    assert.equal(res.handled, true);
    assert.equal(calls.length, 1, "голосовое должно дойти до агента");
    assert.equal(calls[0].message, "послушай это сообщение", "агенту идёт транскрипция, не file_id");
    // D2: sessionKey = tg:{userId}:{chatId}
    assert.equal(calls[0].sessionKey, "tg:123:999");
    assert.equal(sent[0], "транскрипция: ...");
  });

  it("voice without STT → сообщение о недоступности, агент не вызван", async () => {
    let agentCalled = false;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 11,
      message: { from: { id: 123 }, chat: { id: 999 }, voice: { file_id: "v1" } },
    });

    assert.equal(res.handled, true);
    assert.equal(res.reason, "stt-unavailable");
    assert.equal(agentCalled, false);
    assert.deepEqual(sent, ["Голосовые пока недоступны."]);
  });

  it("STT упал → ошибка пользователю, агент не вызван", async () => {
    let agentCalled = false;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      { transcribeVoice: async () => Promise.reject(new Error("stt down")) },
    );

    const res = await bridge.handleUpdate({
      updateId: 12,
      message: { from: { id: 123 }, chat: { id: 999 }, voice: { file_id: "v1" } },
    });

    assert.equal(res.reason, "stt-failed");
    assert.equal(agentCalled, false);
    assert.deepEqual(sent, ["Не удалось распознать голос."]);
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
    assert.deepEqual(handledCtx, { chatId: "999", userId: "123", chatType: "private" });
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

  it("reply goes to the same forum topic as the incoming message", async () => {
    const sent: Array<{ text: string; threadId?: number }> = [];
    const bridge = new TelegramBridge(
      [123],
      async (input) => {
        assert.equal(input.threadId, "42", "агент получает threadId");
        return { text: "ответ в тему" };
      },
      async (_chatId, text, _filePath, extra) => {
        sent.push({ text, threadId: extra?.threadId !== undefined ? Number(extra.threadId) : undefined });
      },
    );

    const res = await bridge.handleUpdate({
      updateId: 30,
      message: { from: { id: 123 }, chat: { id: -100 }, messageId: 5, threadId: "42", isForum: true, text: "привет" },
    });

    assert.equal(res.handled, true);
    assert.equal(sent[0].text, "ответ в тему");
    assert.equal(sent[0].threadId, 42, "ответ уходит в ту же тему");
  });

  it("reply in a non-forum group carries no threadId", async () => {
    const sent: Array<{ threadId?: number }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "ок" }),
      async (_chatId, _text, _filePath, extra) => {
        sent.push({ threadId: extra?.threadId !== undefined ? Number(extra.threadId) : undefined });
      },
    );
    await bridge.handleUpdate({
      updateId: 31,
      message: { from: { id: 123 }, chat: { id: -100 }, text: "привет" },
    });
    assert.equal(sent[0].threadId, undefined);
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
  callbackHandler: ((ctx: TelegramCallbackQueryContext) => unknown) | null = null;
  chatMemberHandler: ((ctx: unknown) => unknown) | null = null;
  sent: Array<{
    chatId: number;
    text: string;
    parseMode?: string;
    buttons?: InlineButton[][];
    threadId?: number;
  }> = [];
  docs: Array<{ chatId: number; filePath: string; caption?: string; threadId?: number }> = [];
  chatActions: Array<{ chatId: number; action: string }> = [];
  reactions: Array<{ chatId: number; messageId: number; reaction: string }> = [];
  commands: Array<{ command: string; description: string }> | null = null;
  private stopResolve: (() => void) | null = null;

  on(
    filter: "message" | "callback_query:data" | "my_chat_member",
    handler: ((ctx: unknown) => unknown) | ((ctx: TelegramCallbackQueryContext) => unknown),
  ): void {
    if (filter === "message") this.handler = handler as (ctx: unknown) => unknown;
    else if (filter === "callback_query:data")
      this.callbackHandler = handler as (ctx: TelegramCallbackQueryContext) => unknown;
    else this.chatMemberHandler = handler as (ctx: unknown) => unknown;
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
    sendMessage: async (
      chatId: number,
      text: string,
      extra?: {
        parseMode?: "HTML";
        inlineButtons?: InlineButton[][];
        messageThreadId?: number;
      },
    ): Promise<unknown> => {
      this.sent.push({
        chatId,
        text,
        parseMode: extra?.parseMode,
        buttons: extra?.inlineButtons,
        threadId: extra?.messageThreadId,
      });
      return undefined;
    },
    sendDocument: async (
      chatId: number,
      filePath: string,
      extra?: { caption?: string; messageThreadId?: number },
    ): Promise<unknown> => {
      this.docs.push({
        chatId,
        filePath,
        caption: extra?.caption,
        threadId: extra?.messageThreadId,
      });
      return undefined;
    },
    sendChatAction: async (chatId: number, action: "typing" | "upload_document"): Promise<unknown> => {
      this.chatActions.push({ chatId, action });
      return undefined;
    },
    setMessageReaction: async (
      chatId: number,
      messageId: number,
      reaction: string,
    ): Promise<unknown> => {
      this.reactions.push({ chatId, messageId, reaction });
      return undefined;
    },
    setMyCommands: async (
      commands: Array<{ command: string; description: string }>,
    ): Promise<unknown> => {
      this.commands = commands;
      return undefined;
    },
    getChatMember: async (): Promise<{ status: string }> => ({ status: "member" }),
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

    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0].chatId, 999);
    assert.equal(fake.sent[0].text, "Готово");
    assert.equal(fake.sent[0].parseMode, "HTML");
    assert.equal(fake.docs.length, 1);
    assert.equal(fake.docs[0].chatId, 999);
    assert.equal(fake.docs[0].filePath, "/tmp/report.pdf");
  });

  it("splits replies longer than 4096 into balanced-HTML messages", async () => {
    const fake = new FakeBot();
    const longText = Array.from(
      { length: 160 },
      (_, i) =>
        `Пункт ${i}. Это предложение содержит **жирный текст** и \`inline\` код для проверки целостности разметки.`,
    ).join("\n\n");
    assert.ok(longText.length > MAX_TELEGRAM_MESSAGE_LENGTH);

    const controller = new TelegramBotController(async () => ({ text: longText }), [123], () => fake);
    controller.start("token");

    await fake.handler?.({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "длинный ответ" },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(fake.sent.length > 1, `ожидалось несколько сообщений, получено ${fake.sent.length}`);
    const count = (s: string, sub: string) => s.split(sub).length - 1;
    for (const m of fake.sent) {
      assert.ok(
        m.text.length <= MAX_TELEGRAM_MESSAGE_LENGTH,
        `чанк длиной ${m.text.length} превышает лимит Telegram`,
      );
      assert.equal(count(m.text, "<b>"), count(m.text, "</b>"), "тег <b> разорван между чанками");
      assert.equal(count(m.text, "<code>"), count(m.text, "</code>"), "тег <code> разорван между чанками");
      assert.equal(m.parseMode, "HTML");
    }
  });

  it("splitTelegramText keeps every chunk within the target and loses no content", () => {
    const para = "Первое предложение. Второе предложение! Третье предложение? ";
    const text = para.repeat(600);
    const chunks = splitTelegramText(text);
    assert.ok(chunks.length > 1);
    for (const c of chunks) {
      // Критерий сплиттера — длина ПОСЛЕ форматирования: каждый отправляемый
      // чанк обязан влезать в лимит Telegram.
      assert.ok(
        formatTelegramHtml(c).length <= MAX_TELEGRAM_MESSAGE_LENGTH,
        `чанк длиной ${formatTelegramHtml(c).length}`,
      );
    }
    assert.equal(
      chunks.join("").replace(/\s/g, ""),
      text.replace(/\s/g, ""),
      "контент не должен теряться при разбивке",
    );
  });

  it("passes message_thread_id to sendMessage for forum messages", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "в тему" }), [123], () => fake);
    controller.start("token");

    await fake.handler?.({
      update: { update_id: 1 },
      message: {
        from: { id: 123 },
        chat: { id: -100, is_forum: true },
        message_id: 5,
        message_thread_id: 42,
        text: "привет",
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(fake.sent[0].threadId, 42, "sendMessage должен нести message_thread_id");
  });

  it("sets a 👍 reaction on the original contact message", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(
      async () => ({ text: "Контакт сохранён" }),
      [123],
      () => fake,
    );
    controller.start("token");

    await fake.handler?.({
      update: { update_id: 1 },
      message: {
        from: { id: 123 },
        chat: { id: 999 },
        message_id: 77,
        contact: { first_name: "Иван" },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(fake.reactions, [{ chatId: 999, messageId: 77, reaction: "👍" }]);
    // Содержательный ответ агента остаётся текстовым сообщением.
    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0].text, "Контакт сохранён");
  });

  it("D4: aclCheck true → approval callback разрешён, даже если id не в allowedUserIds", async () => {
    const fake = new FakeBot();
    const handledBy: string[] = [];
    const controller = new TelegramBotController(async () => ({ text: "x" }), [1], () => fake, {
      aclCheck: async () => true,
      approvalHandler: (_action, id) => {
        handledBy.push(id);
        return "ok";
      },
    });
    controller.start("token");

    await fake.callbackHandler?.({
      from: { id: 999 },
      data: "approve:abc",
      message: { chat: { id: 999 }, message_id: 1, text: "t" },
      answerCallbackQuery: async () => undefined,
      editMessageText: async () => undefined,
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(handledBy, ["abc"], "ACL — единый источник, не allowedUserIds");
  });

  it("D4: aclCheck false → callback отклонён, даже если id в allowedUserIds", async () => {
    const fake = new FakeBot();
    const handledBy: string[] = [];
    const answers: string[] = [];
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake, {
      aclCheck: async () => false,
      approvalHandler: (_action, id) => {
        handledBy.push(id);
        return "ok";
      },
    });
    controller.start("token");

    await fake.callbackHandler?.({
      from: { id: 123 },
      data: "approve:abc",
      message: { chat: { id: 123 }, message_id: 1, text: "t" },
      answerCallbackQuery: async (text) => {
        answers.push(text ?? "");
      },
      editMessageText: async () => undefined,
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(handledBy, []);
    assert.deepEqual(answers, ["Недоступно."]);
  });

  it("P0: my_chat_member читается через camelCase getter myChatMember", async () => {
    const fake = new FakeBot();
    const events: TelegramChatMemberEvent[] = [];
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake, {
      chatMemberHandler: async (event) => {
        events.push(event);
      },
    });
    controller.start("token");

    await fake.chatMemberHandler?.({
      // grammy: getter myChatMember (camelCase) — плоского my_chat_member нет.
      myChatMember: {
        old_chat_member: { status: "left" },
        new_chat_member: { status: "member" },
      },
      chat: { id: -100, type: "supergroup", title: "Отдел" },
      from: { id: 42 },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(events.length, 1, "событие дошло до chatMemberHandler");
    assert.equal(events[0].oldStatus, "left");
    assert.equal(events[0].newStatus, "member");
    assert.equal(events[0].chat.id, -100);
    assert.equal(events[0].from.id, 42);
    await controller.stop();
  });

  it("my_chat_member: сырое update.my_chat_member (snake) тоже парсится", async () => {
    const fake = new FakeBot();
    const events: TelegramChatMemberEvent[] = [];
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake, {
      chatMemberHandler: async (event) => {
        events.push(event);
      },
    });
    controller.start("token");

    await fake.chatMemberHandler?.({
      update: {
        my_chat_member: {
          old_chat_member: { status: "kicked" },
          new_chat_member: { status: "administrator" },
        },
      },
      chat: { id: -200, type: "group", title: "G" },
      from: { id: 7 },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(events.length, 1);
    assert.equal(events[0].oldStatus, "kicked");
    assert.equal(events[0].newStatus, "administrator");
    await controller.stop();
  });

  it("FR-6: сервисное сообщение (new_chat_members) не идёт в агента", async () => {
    const fake = new FakeBot();
    let agentCalls = 0;
    const controller = new TelegramBotController(
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      [123],
      () => fake,
    );
    controller.start("token");

    await fake.handler?.({
      update: { update_id: 1 },
      message: {
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        new_chat_members: [{ id: 999 }],
        text: "привет",
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(agentCalls, 0, "агент не вызывается на сервисное сообщение");
    assert.equal(fake.sent.length, 0, "ответа нет");
    await controller.stop();
  });

  it("send_file через контроллер: документ в чат (с темой форума), ошибки без падения", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake);
    controller.start("token");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-sendfile-"));
    const filePath = path.join(dir, "f.txt");
    fs.writeFileSync(filePath, "hello");

    const res = await controller.sendFileToChat({
      chatId: -100,
      filePath,
      caption: "подпись",
      threadId: 15,
    });
    assert.equal(res.ok, true);
    assert.equal(fake.docs.length, 1);
    assert.equal(fake.docs[0].chatId, -100);
    assert.equal(fake.docs[0].caption, "подпись");
    assert.equal(fake.docs[0].threadId, 15, "форум: документ в ту же тему");

    const missing = await controller.sendFileToChat({
      chatId: -100,
      filePath: path.join(dir, "nope.txt"),
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.error!.includes("Файл не найден"));
    assert.equal(fake.docs.length, 1, "неудачная отправка не добавила документ");

    fs.rmSync(dir, { recursive: true, force: true });
    await controller.stop();
  });

  it("D7: HTML-сбой → plain-text фолбэк того же чанка", async () => {
    const sent: Array<{ text: string; parseMode?: string }> = [];
    let messageHandler: ((ctx: unknown) => unknown) | null = null;
    const fakeBot: TelegramBotLike = {
      on: (filter, h) => {
        if (filter === "message") messageHandler = h as (ctx: unknown) => unknown;
      },
      start: async () => undefined,
      stop: async () => undefined,
      api: {
        sendMessage: async (chatId, text, extra) => {
          if (extra?.parseMode === "HTML") throw new Error("can't parse entities");
          sent.push({ text, parseMode: extra?.parseMode });
        },
        sendDocument: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
        setMessageReaction: async () => undefined,
        getChatMember: async () => ({ status: "member" }),
      },
    };
    const controller = new TelegramBotController(
      async () => ({ text: "**жирный** текст" }),
      [123],
      () => fakeBot,
      { sendRetry: { maxAttempts: 1, delayMs: () => 0 } },
    );
    controller.start("token");

    const handler = messageHandler as ((ctx: unknown) => unknown) | null;
    if (!handler) throw new Error("handler not wired");
    await handler({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(sent.length, 1, "один plain-фолбэк");
    assert.equal(sent[0].text, "**жирный** текст", "plain — сырой чанк без HTML");
    assert.equal(sent[0].parseMode, undefined);
  });

  it("D9: /start в DM добавляет hint про pending-группы", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        pendingGroupsHint: async (userId) =>
          userId === "123"
            ? "\n\nЕсть группы без настройки: 2. Отправьте /setup чтобы получить кнопки."
            : "",
      },
    );

    await bridge.handleUpdate({
      updateId: 60,
      message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text: "/start" },
    });

    assert.ok(sent[0].includes("Привет! Я Гриша"));
    assert.ok(sent[0].includes("Есть группы без настройки: 2"));
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
  /** When set, the session queues these inline buttons before ending the turn. */
  pendingButtons?: InlineButton[][];
  /** When set, the session registers this caption for the pending file. */
  pendingCaption?: string;

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    // Регистрация одноразовая: как реальный tool, который регистрирует файл
    // только в том ходу, в котором его вызвали.
    if (this.pendingFile) {
      setSessionFile(this.sessionId, this.pendingFile, this.pendingCaption);
      this.pendingFile = undefined;
      this.pendingCaption = undefined;
    }
    if (this.pendingButtons) {
      addSessionInlineButtons(this.sessionId, this.pendingButtons);
      this.pendingButtons = undefined;
    }
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
    const sessions = new Map<string, FakeAgentSession>();
    const pool = new TelegramSessionPool({
      sessionFactory: async (sessionKey) => {
        const s = new FakeAgentSession();
        sessions.set(sessionKey, s);
        return s as unknown as AgentSession;
      },
    });
    return { pool, sessions };
  }

  it("creates one isolated session per session key", async () => {
    const { pool, sessions } = makePool();
    const a = await pool.handleMessage("tg:1:1", 1, "привет", { chatId: "1" });
    const b = await pool.handleMessage("tg:2:2", 2, "hi", { chatId: "2" });
    assert.equal(a.text, "ответ на: привет");
    assert.equal(b.text, "ответ на: hi");
    assert.equal(pool.activeCount(), 2);
    assert.equal(sessions.size, 2);
    assert.deepEqual(sessions.get("tg:1:1")!.prompts, ["привет"]);
    assert.deepEqual(sessions.get("tg:2:2")!.prompts, ["hi"]);
  });

  it("reuses the same session for the same key", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage("tg:1:1", 1, "первое", { chatId: "1" });
    await pool.handleMessage("tg:1:1", 1, "второе", { chatId: "1" });
    assert.equal(sessions.size, 1);
    assert.deepEqual(sessions.get("tg:1:1")!.prompts, ["первое", "второе"]);
    assert.equal(pool.activeCount(), 1);
  });

  it("D2: один user в двух чатах → две изолированные сессии", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage("tg:7:-100", 7, "группа", { chatId: "-100" });
    await pool.handleMessage("tg:7:7", 7, "дм", { chatId: "7" });
    assert.equal(sessions.size, 2);
    assert.deepEqual(sessions.get("tg:7:-100")!.prompts, ["группа"]);
    assert.deepEqual(sessions.get("tg:7:7")!.prompts, ["дм"]);
  });

  it("R-GR-3: rulesContext передаётся в prompt на каждый ход", async () => {
    const { pool, sessions } = makePool();
    const rulesContext = "[GROUP_RULES]\n- length=short\n[/GROUP_RULES]";
    await pool.handleMessage("tg:1:-100", 1, "привет", {
      chatId: "-100",
      rulesContext,
    });
    await pool.handleMessage("tg:1:-100", 1, "второе", {
      chatId: "-100",
      rulesContext,
    });
    const prompts = sessions.get("tg:1:-100")!.prompts;
    assert.equal(prompts.length, 2);
    for (const p of prompts) {
      assert.ok(p.startsWith(rulesContext), "каждый ход — с префиксом правил");
      assert.ok(p.endsWith("привет") || p.endsWith("второе"));
    }
  });

  it("/new сбрасывает только один ключ (другие чаты живы)", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage("tg:7:-100", 7, "группа", { chatId: "-100" });
    await pool.handleMessage("tg:7:7", 7, "дм", { chatId: "7" });
    await pool.reset("tg:7:7");
    assert.equal(pool.activeCount(), 1);
    assert.equal(sessions.get("tg:7:-100") !== undefined, true, "другой чат не тронут");
  });

  it("disposes all sessions on shutdown", async () => {
    const { pool, sessions } = makePool();
    await pool.handleMessage("tg:1:1", 1, "x", { chatId: "1" });
    await pool.handleMessage("tg:2:2", 2, "y", { chatId: "2" });
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
    const reply = await pool.handleMessage("tg:1:1", 1, "отчёт", { chatId: "1" });
    assert.equal(reply.text, "ответ на: отчёт");
    assert.equal(reply.filePath, "/tmp/report.pdf");
  });

  it("returns no filePath when nothing was generated", async () => {
    const { pool } = makePool();
    const reply = await pool.handleMessage("tg:1:1", 1, "привет", { chatId: "1" });
    assert.equal(reply.filePath, undefined);
  });

  it("picks up the document caption and inline buttons queued during the turn", async () => {
    const buttons: InlineButton[][] = [
      [
        { text: "✅ Одобрить", callbackData: "approve:abc" },
        { text: "❌ Отклонить", callbackData: "deny:abc" },
      ],
    ];
    const pool = new TelegramSessionPool({
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        s.pendingFile = "/tmp/report.pdf";
        s.pendingCaption = "Отчёт по продажам за март";
        s.pendingButtons = buttons;
        return s as unknown as AgentSession;
      },
    });
    const reply = await pool.handleMessage("tg:1:1", 1, "отчёт", { chatId: "1" });
    assert.equal(reply.filePath, "/tmp/report.pdf");
    assert.equal(reply.documentCaption, "Отчёт по продажам за март");
    assert.deepEqual(reply.inlineButtons, buttons);
  });

  it("does not leak buttons into the next turn", async () => {
    const pool = new TelegramSessionPool({
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        s.pendingButtons = [[{ text: "x", callbackData: "y" }]];
        return s as unknown as AgentSession;
      },
    });
    const first = await pool.handleMessage("tg:1:1", 1, "нужно подтверждение", { chatId: "1" });
    assert.equal(first.inlineButtons?.length, 1);
    const second = await pool.handleMessage("tg:1:1", 1, "спасибо", { chatId: "1" });
    assert.equal(second.inlineButtons, undefined);
  });
});

describe("telegram bridge approval fallback and extras", () => {
  it("passes inlineButtons and documentCaption to the sender", async () => {
    const buttons: InlineButton[][] = [
      [{ text: "✅ Одобрить", callbackData: "approve:xyz" }],
    ];
    const sent: Array<{
      text: string;
      buttons?: InlineButton[][];
      caption?: string;
    }> = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "нужно подтверждение", inlineButtons: buttons, documentCaption: "файл" }),
      async (_chatId, _text, _filePath, extra) => {
        sent.push({ text: _text, buttons: extra?.inlineButtons, caption: extra?.documentCaption });
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "действие" },
    });
    assert.equal(sent[0].text, "нужно подтверждение");
    assert.deepEqual(sent[0].buttons, buttons);
    assert.equal(sent[0].caption, "файл");
  });

  it("/approve text fallback calls the shared approval handler", async () => {
    const decisions: Array<{ action: string; id: string }> = [];
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        approvalHandler: (action, id) => {
          decisions.push({ action, id });
          return "Одобрено.";
        },
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "/approve 1234abcd" },
    });
    assert.deepEqual(decisions, [{ action: "approve", id: "1234abcd" }]);
    assert.equal(sent[0], "Одобрено.");
  });

  it("/deny without id asks for the id", async () => {
    let called = 0;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        approvalHandler: () => {
          called++;
          return "x";
        },
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 123 }, chat: { id: 999 }, text: "/deny" },
    });
    assert.equal(called, 0);
    assert.equal(sent[0], "Укажите id: /deny <id>");
  });
});

describe("formatTelegramHtml", () => {
  it("escapes < > & before any tag conversion", () => {
    assert.equal(formatTelegramHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  });

  it("converts **bold** and `code` markdown", () => {
    assert.equal(formatTelegramHtml("это **жирно** и `код`"), "это <b>жирно</b> и <code>код</code>");
  });

  it("leaves unbalanced markers untouched", () => {
    assert.equal(formatTelegramHtml("a ** b * c"), "a ** b * c");
  });
});

describe("telegram callback_query inline buttons", () => {
  function fakeCallbackContext(data: string, userId = 123): TelegramCallbackQueryContext & {
    answered?: string;
    edited?: { text: string; removeKeyboard?: boolean };
  } {
    const ctx: TelegramCallbackQueryContext & {
      answered?: string;
      edited?: { text: string; removeKeyboard?: boolean };
    } = {
      from: { id: userId },
      data,
      message: { chat: { id: 999 }, message_id: 7, text: "нужно подтверждение" },
      answerCallbackQuery: async (text) => {
        ctx.answered = text;
      },
      editMessageText: async (text, extra) => {
        ctx.edited = { text, removeKeyboard: extra?.removeKeyboard };
      },
    };
    return ctx;
  }

  it("calls the shared approval handler via grant path and removes the keyboard", async () => {
    const fake = new FakeBot();
    const decisions: Array<{ action: string; id: string }> = [];
    const controller = new TelegramBotController(
      async () => ({ text: "x" }),
      [123],
      () => fake,
      {
        approvalHandler: (action, id) => {
          decisions.push({ action, id });
          return "Одобрено.";
        },
      },
    );
    controller.start("token");
    assert.ok(fake.callbackHandler, "callback handler should be wired");

    const ctx = fakeCallbackContext("approve:req-123");
    await fake.callbackHandler!(ctx);
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(decisions, [{ action: "approve", id: "req-123" }]);
    assert.equal(ctx.answered, "Одобрено.");
    assert.deepEqual(ctx.edited, {
      text: "нужно подтверждение\n\nОдобрено.",
      removeKeyboard: true,
    });
    await controller.stop();
  });

  it("routes deny callback_data to deny", async () => {
    const fake = new FakeBot();
    const decisions: Array<{ action: string; id: string }> = [];
    const controller = new TelegramBotController(
      async () => ({ text: "x" }),
      [123],
      () => fake,
      {
        approvalHandler: (action, id) => {
          decisions.push({ action, id });
          return "Отклонено.";
        },
      },
    );
    controller.start("token");
    const ctx = fakeCallbackContext("deny:req-456");
    await fake.callbackHandler!(ctx);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(decisions, [{ action: "deny", id: "req-456" }]);
    assert.equal(ctx.answered, "Отклонено.");
    assert.equal(ctx.edited?.removeKeyboard, true);
    await controller.stop();
  });

  it("ignores callback queries from non-allowed users", async () => {
    const fake = new FakeBot();
    let called = 0;
    const controller = new TelegramBotController(
      async () => ({ text: "x" }),
      [123],
      () => fake,
      {
        approvalHandler: () => {
          called++;
          return "x";
        },
      },
    );
    controller.start("token");
    const ctx = fakeCallbackContext("approve:req-1", 999);
    await fake.callbackHandler!(ctx);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(called, 0);
    assert.equal(ctx.answered, "Недоступно.");
    assert.equal(ctx.edited, undefined);
    await controller.stop();
  });
});

describe("telegram bot startup extras", () => {
  it("advertises real commands via setMyCommands", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake);
    controller.start("token");
    // setMyCommands уходит fire-and-forget — даём микрозадаче выполниться.
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(fake.commands, "setMyCommands should be called at startup");
    const names = fake.commands.map((c) => c.command);
    for (const expected of ["start", "new", "status", "rules", "approve", "deny"]) {
      assert.ok(names.includes(expected), `expected command ${expected}`);
    }
    await controller.stop();
  });

  it("sends typing chat action before the agent replies", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [123], () => fake);
    controller.start("token");
    await fake.handler?.({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "привет" },
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(
      fake.chatActions.some((a) => a.chatId === 999 && a.action === "typing"),
      "typing action expected before reply",
    );
    await controller.stop();
  });

  it("sends upload_document chat action before sending a document", async () => {
    const fake = new FakeBot();
    const controller = new TelegramBotController(
      async () => ({ text: "Готово", filePath: "/tmp/report.pdf", documentCaption: "Отчёт по продажам за март" }),
      [123],
      () => fake,
    );
    controller.start("token");
    await fake.handler?.({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "отчёт" },
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(
      fake.chatActions.some((a) => a.chatId === 999 && a.action === "upload_document"),
      "upload_document action expected before document",
    );
    assert.equal(fake.docs[0].caption, "Отчёт по продажам за март");
    await controller.stop();
  });

  it("attaches inline keyboard to sendMessage when the reply carries buttons", async () => {
    const fake = new FakeBot();
    const buttons: InlineButton[][] = [
      [{ text: "✅ Одобрить", callbackData: "approve:q" }],
    ];
    const controller = new TelegramBotController(
      async () => ({ text: "нужно подтверждение", inlineButtons: buttons }),
      [123],
      () => fake,
    );
    controller.start("token");
    await fake.handler?.({
      update: { update_id: 1 },
      message: { from: { id: 123 }, chat: { id: 999 }, text: "действие" },
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(fake.sent[0].buttons, buttons);
    await controller.stop();
  });
});
