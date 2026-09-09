import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectMentionFlags,
  mergeMentionFlags,
  type MentionEntity,
} from "../../.pi/extensions/telegram-bot/mentions.js";
import { TelegramBotController } from "../../.pi/extensions/telegram-bot/TelegramBotController.js";
import type { TelegramBotLike } from "../../.pi/extensions/telegram-bot/TelegramBotController.js";

const mention = (offset: number, length: number): MentionEntity => ({
  type: "mention",
  offset,
  length,
});

describe("collectMentionFlags (D1)", () => {
  const self = { id: 777, username: "griha_ai_bot" };

  it("text @Bot + entities → botMentioned", () => {
    const text = "@griha_ai_bot hello";
    const flags = collectMentionFlags(text, [mention(0, 13)], self);
    assert.equal(flags.botMentioned, true);
    assert.equal(flags.startsWithOtherMention, false);
  });

  it("caption @Bot с caption_entities (entities пусто) → botMentioned", () => {
    const caption = "@griha_ai_bot чек";
    const flags = collectMentionFlags(caption, [mention(0, 13)], self);
    assert.equal(flags.botMentioned, true);
  });

  it("@Other в начале → startsWithOtherMention", () => {
    const flags = collectMentionFlags("@ivan привет", [mention(0, 5)], self);
    assert.equal(flags.startsWithOtherMention, true);
    assert.equal(flags.botMentioned, false);
  });

  it("text_mention с self.id → botMentioned (без username)", () => {
    const flags = collectMentionFlags(
      "привет",
      [{ type: "text_mention", offset: 0, length: 6, user: { id: 777 } }],
      { id: 777 }, // username нет
    );
    assert.equal(flags.botMentioned, true);
  });

  it("без self.username обычный @ не матчится (documented)", () => {
    const flags = collectMentionFlags("@griha_ai_bot hi", [mention(0, 14)], { id: 777 });
    assert.equal(flags.botMentioned, false);
  });

  it("mergeMentionFlags: ИЛИ по обоим источникам", () => {
    const merged = mergeMentionFlags(
      { botMentioned: false, startsWithOtherMention: true },
      { botMentioned: true, startsWithOtherMention: false },
    );
    assert.deepEqual(merged, { botMentioned: true, startsWithOtherMention: true });
  });
});

describe("toTgUpdate: caption_entities (D1 integration)", () => {
  it("caption @bot на фото → prefilter видит botMentioned", async () => {
    let messageHandler: ((ctx: unknown) => unknown) | null = null;
    let captured: Record<string, unknown> | null = null;
    const fake: TelegramBotLike = {
      on: (filter, h) => {
        if (filter === "message") messageHandler = h as (ctx: unknown) => unknown;
      },
      start: async () => undefined,
      stop: async () => undefined,
      api: {
        sendMessage: async () => undefined,
        sendDocument: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
        setMessageReaction: async () => undefined,
        getChatMember: async () => ({ status: "member" }),
      },
    };
    const controller = new TelegramBotController(
      async () => ({ text: "ok" }),
      [123],
      () => fake,
      {
        getBotSelf: () => ({ id: 777, username: "griha_ai_bot" }),
        prefilter: (input) => {
          captured = { ...input };
          return true;
        },
      },
    );
    controller.start("token");
    const handler = messageHandler as ((ctx: unknown) => unknown) | null;
    if (!handler) throw new Error("handler not wired");

    await handler({
      update: { update_id: 1 },
      message: {
        from: { id: 123 },
        chat: { id: -100, type: "supergroup" },
        caption: "@griha_ai_bot чек на 15400",
        caption_entities: [{ type: "mention", offset: 0, length: 13 }],
        photo: [{ file_id: "p1", file_unique_id: "pu1" }],
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(
      (captured as Record<string, unknown> | null)?.botMentioned,
      true,
      "caption_entities должны давать botMentioned",
    );
  });
});
