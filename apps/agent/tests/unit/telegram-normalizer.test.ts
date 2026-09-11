/**
 * PROMPT 02 — единая нормализация: message | channel_post |
 * edited_message | edited_channel_post; sender_chat; topics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contentKindOf,
  normalizeChatType,
  normalizeTelegramUpdate,
  rawMessageOf,
} from "../../.pi/extensions/telegram-bot/normalizer.js";

const self = { id: 777, username: "griha_ai_bot" };

describe("normalizer: chat kinds и update kinds", () => {
  it("message в группе → kind=message, chat=group", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 1 },
        message: { message_id: 10, chat: { id: -100, type: "group" }, text: "hi" },
      },
      { botSelf: self },
    )!;
    assert.equal(n.updateKind, "message");
    assert.equal(n.chat.type, "group");
    assert.equal(n.chat.id, "-100");
    assert.equal(n.message.contentKind, "text");
    assert.equal(n.message.isEdited, false);
    assert.equal(n.message.sender?.userId, undefined, "без from — без userId");
  });

  it("message в supergroup с from → sender.userId", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 2 },
        message: {
          message_id: 11,
          from: { id: 42, first_name: "Иван" },
          chat: { id: -200, type: "supergroup" },
          text: "привет",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.chat.type, "supergroup");
    assert.equal(n.message.sender?.userId, "42");
    assert.equal(n.message.sender?.displayName, "Иван");
  });

  it("channel_post без from → sender_chat, chat=channel", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 3 },
        channel_post: {
          message_id: 20,
          sender_chat: { id: -300, title: "Мой канал", type: "channel" },
          chat: { id: -300, type: "channel", title: "Мой канал" },
          text: "пост канала",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.updateKind, "channel_post");
    assert.equal(n.chat.type, "channel");
    assert.equal(n.message.sender?.userId, undefined, "from отсутствует — без userId");
    assert.equal(n.message.sender?.senderChatId, "-300");
    assert.equal(n.message.sender?.displayName, "Мой канал");
  });

  it("edited_message → isEdited + editDate", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 4 },
        edited_message: {
          message_id: 30,
          edit_date: 12345,
          from: { id: 42 },
          chat: { id: -100, type: "supergroup" },
          text: "правка",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.updateKind, "edited_message");
    assert.equal(n.message.isEdited, true);
    assert.equal(n.message.editDate, 12345);
  });

  it("edited_channel_post → kind=edited_channel_post", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 5 },
        edited_channel_post: {
          message_id: 40,
          edit_date: 9,
          sender_chat: { id: -300, type: "channel" },
          chat: { id: -300, type: "channel" },
          text: "правка поста",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.updateKind, "edited_channel_post");
    assert.equal(n.message.isEdited, true);
    assert.equal(n.chat.type, "channel");
  });

  it("topic: message_thread_id ?? reply_to_message.message_thread_id", () => {
    const direct = normalizeTelegramUpdate(
      {
        update: { update_id: 6 },
        message: {
          message_id: 50,
          from: { id: 42 },
          chat: { id: -100, type: "supergroup", is_forum: true },
          message_thread_id: 15,
          text: "в теме",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(direct.message.threadId, "15");

    const viaReply = normalizeTelegramUpdate(
      {
        update: { update_id: 7 },
        message: {
          message_id: 51,
          from: { id: 42 },
          chat: { id: -100, type: "supergroup", is_forum: true },
          reply_to_message: { from: { id: 777 }, message_thread_id: 20 },
          text: "reply в теме",
        },
      },
      { botSelf: self },
    )!;
    assert.equal(viaReply.message.threadId, "20", "fallback из reply_to_message");
    assert.equal(viaReply.message.repliedToBot, true);
  });
});

describe("normalizer: контент и файлы", () => {
  it("channel_post с photo → contentKind=photo, file_id из последнего размера", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 8 },
        channel_post: {
          message_id: 60,
          sender_chat: { id: -300, type: "channel" },
          chat: { id: -300, type: "channel" },
          caption: "фото с подписью",
          photo: [
            { file_id: "small", file_unique_id: "su" },
            { file_id: "big", file_unique_id: "bu" },
          ],
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.message.contentKind, "photo");
    assert.equal(n.message.telegramFileId, "big");
    assert.equal(n.message.telegramFileUniqueId, "bu");
    assert.equal(n.message.caption, "фото с подписью");
  });

  it("channel_post с document → mime/fileName", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 9 },
        channel_post: {
          message_id: 61,
          sender_chat: { id: -300, type: "channel" },
          chat: { id: -300, type: "channel" },
          document: { file_id: "d1", file_unique_id: "du1", file_name: "a.pdf", mime_type: "application/pdf" },
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.message.contentKind, "document");
    assert.equal(n.message.mimeType, "application/pdf");
    assert.equal(n.message.fileName, "a.pdf");
    assert.equal(n.message.telegramFileId, "d1");
  });

  it("voice → contentKind=voice", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 10 },
        message: {
          message_id: 62,
          from: { id: 42 },
          chat: { id: -100, type: "supergroup" },
          voice: { file_id: "v1", file_unique_id: "vu1", duration: 7, mime_type: "audio/ogg" },
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.message.contentKind, "voice");
    assert.equal(n.message.telegramFileId, "v1");
    assert.equal(n.message.voiceDuration, 7);
  });

  it("сервисные сообщения помечаются isService", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 11 },
        message: {
          message_id: 63,
          chat: { id: -100, type: "supergroup" },
          new_chat_members: [{ id: 1 }],
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.message.isService, true);
  });

  it("mention-флаги: caption_entities дают botMentioned", () => {
    const n = normalizeTelegramUpdate(
      {
        update: { update_id: 12 },
        message: {
          message_id: 64,
          from: { id: 42 },
          chat: { id: -100, type: "supergroup" },
          caption: "@griha_ai_bot чек",
          caption_entities: [{ type: "mention", offset: 0, length: 13 }],
          photo: [{ file_id: "p1" }],
        },
      },
      { botSelf: self },
    )!;
    assert.equal(n.message.botMentioned, true);
    assert.equal(n.message.contentKind, "photo");
  });

  it("rawMessageOf и normalizeChatType — краевые случаи", () => {
    assert.equal(rawMessageOf(null), null);
    assert.equal(rawMessageOf({}), null);
    assert.equal(normalizeChatType(undefined), "private");
    assert.equal(normalizeChatType("unknown"), "private");
    assert.equal(normalizeChatType("channel"), "channel");
  });
});

describe("normalizer: contentKindOf", () => {
  it("приоритет photo > document > voice > contact > location > text", () => {
    assert.equal(contentKindOf({ text: "x", photo: [{ file_id: "p" }] }), "photo");
    assert.equal(contentKindOf({ text: "x", document: { file_id: "d" } }), "document");
    assert.equal(contentKindOf({ voice: { file_id: "v" } }), "voice");
    assert.equal(contentKindOf({ contact: { phone_number: "1" } }), "contact");
    assert.equal(contentKindOf({ location: { latitude: 1 } }), "location");
    assert.equal(contentKindOf({ text: "x" }), "text");
    assert.equal(contentKindOf({ caption: "c" }), "text");
    assert.equal(contentKindOf({}), "other");
  });
});
