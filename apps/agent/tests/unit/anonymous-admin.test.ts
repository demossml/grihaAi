/**
 * P03: anonymous admin (GroupAnonymousBot 1087968824 / sender_chat == chat.id).
 * Guard: групповая сессия tg:anon:{chat}{:t:{thread}}, архив без fake fromUserId.
 * LIVE-UNVERIFIED: реальный payload проверяется на проде.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelegramBridge,
  TELEGRAM_ANONYMOUS_ADMIN_ID,
  type GrishaAgent,
  type TgMessage,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

interface Captured {
  sessionKey?: string;
  userId?: number | string;
  message?: string;
}

interface ArchiveSeen {
  fromId?: number;
  chatId?: number;
}

function makeBridge(opts: {
  prefilter?: (input: unknown) => unknown;
} = {}) {
  const agentCalls: Captured[] = [];
  const archived: ArchiveSeen[] = [];
  const sent: string[] = [];
  const agent: GrishaAgent = async (input) => {
    agentCalls.push({
      sessionKey: input.sessionKey,
      userId: input.userId,
      message: input.message,
    });
    return { text: "ответ" };
  };
  const bridge = new TelegramBridge([], agent, async (_chatId, text) => {
    sent.push(text);
  }, {
    telegramAccess: {
      isAllowedPrivate: async () => false,
      getChatMember: async () => ({ status: "administrator" }),
    },
    prefilter: opts.prefilter as never,
    archiveHandler: async (msg: TgMessage) => {
      archived.push({ fromId: msg.from?.id, chatId: msg.chat?.id });
      return { stored: true };
    },
  });
  return { bridge, agentCalls, archived, sent };
}

function anonUpdate(text = "привет", threadId?: string) {
  return {
    updateId: 1,
    message: {
      from: { id: TELEGRAM_ANONYMOUS_ADMIN_ID },
      senderChat: { id: -1001, title: "Группа" },
      chat: { id: -1001, type: "supergroup" },
      threadId,
      text,
    },
  };
}

describe("P03 anonymous admin", () => {
  it("anonymous admin → агент работает, сессия групповая tg:anon:{chat} (не fake-id)", async () => {
    const { bridge, agentCalls, sent } = makeBridge();
    await bridge.handleUpdate(anonUpdate("вопрос"));
    await bridge.handleUpdate(anonUpdate("ещё вопрос"));
    assert.equal(agentCalls.length, 2);
    assert.equal(agentCalls[0].sessionKey, "tg:anon:-1001");
    assert.equal(agentCalls[1].sessionKey, "tg:anon:-1001");
    assert.equal(agentCalls[0].userId, TELEGRAM_ANONYMOUS_ADMIN_ID, "ACL id не меняем");
    assert.equal(sent.length, 2);
  });

  it("sender_chat.id === chat.id в supergroup с реальным from → тоже anonymous", async () => {
    const { bridge, agentCalls } = makeBridge();
    await bridge.handleUpdate({
      updateId: 2,
      message: {
        from: { id: 999 },
        senderChat: { id: -1002 },
        chat: { id: -1002, type: "supergroup" },
        text: "привет",
      },
    });
    assert.equal(agentCalls.length, 1);
    assert.equal(agentCalls[0].sessionKey, "tg:anon:-1002");
  });

  it("anonymous + тема форума → tg:anon:{chat}:t:{thread}", async () => {
    const { bridge, agentCalls } = makeBridge();
    await bridge.handleUpdate(anonUpdate("в топике", "5"));
    assert.equal(agentCalls[0].sessionKey, "tg:anon:-1001:t:5");
  });

  it("обычный участник → персональная сессия tg:{user}:{chat}, from НЕ стрипается", async () => {
    const { bridge, agentCalls } = makeBridge();
    await bridge.handleUpdate({
      updateId: 3,
      message: {
        from: { id: 7 },
        chat: { id: -1001, type: "supergroup" },
        text: "привет",
      },
    });
    assert.equal(agentCalls.length, 1);
    assert.equal(agentCalls[0].sessionKey, "tg:7:-1001");
  });

  it("архив: anonymous → from = undefined (не фейковый id)", async () => {
    const { bridge, archived, agentCalls } = makeBridge({
      prefilter: () => ({ process: false, suppressReply: true, archive: true }),
    });
    await bridge.handleUpdate(anonUpdate("в архив"));
    assert.equal(agentCalls.length, 0);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].fromId, undefined, "нет фейкового 1087968824 в архиве");
    assert.equal(archived[0].chatId, -1001);
  });

  it("архив: обычный участник сохраняет fromUserId", async () => {
    const { bridge, archived } = makeBridge({
      prefilter: () => ({ process: false, suppressReply: true, archive: true }),
    });
    await bridge.handleUpdate({
      updateId: 4,
      message: {
        from: { id: 7 },
        chat: { id: -1001, type: "supergroup" },
        text: "в архив",
      },
    });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].fromId, 7);
  });

  it("channel post (без from, sender_chat=канал) → agent denied (поведение сохранено)", async () => {
    const { bridge, agentCalls, sent } = makeBridge();
    const res = await bridge.handleUpdate({
      updateId: 5,
      message: {
        senderChat: { id: -1003 },
        chat: { id: -1003, type: "channel" },
        text: "пост",
      },
    });
    assert.equal(agentCalls.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(res.handled, true);
  });
});
