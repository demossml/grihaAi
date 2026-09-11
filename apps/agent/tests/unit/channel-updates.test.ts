/**
 * PROMPT 02 — каналы и правки в bridge: channel_post → policy → archive/медиа,
 * agent denied; edited_* не теряются (ревизии архива).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgMessage, TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { ChatArchiveService } from "../../src/services/documents/chat-archive.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { StubExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-archive-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

/** Канал: listen_only — архив без агента. */
const channelUpdate = (extra: Partial<TgMessage> = {}): TgUpdate => ({
  updateId: 1,
  updateKind: "channel_post",
  message: {
    senderChat: { id: -300, title: "Мой канал" },
    chat: { id: -300, type: "channel" },
    messageId: 20,
    text: "пост канала",
    ...extra,
  },
});

describe("channel_post в bridge (policy → archive, agent denied)", () => {
  it("channel_post text + listener policy → архив, агент НЕ вызывается", async () => {
    let agentCalls = 0;
    const archives: Array<{ kind: string; text?: string }> = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prepareTurn: () => ({ process: false, suppressReply: true, archive: true, rulesContext: "" }),
        archiveHandler: async (msg, ctx) => {
          archives.push({ kind: ctx.kind, text: msg.text });
          return { stored: true };
        },
      },
    );

    const res = await bridge.handleUpdate(channelUpdate());
    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.equal(archives.length, 1);
    assert.equal(archives[0].kind, "text");
    assert.equal(archives[0].text, "пост канала");
    assert.equal(agentCalls, 0, "channel → нет агента");
  });

  it("channel_post с photo → processMedia вызван (OCR-конвейер), агент — нет", async () => {
    let agentCalls = 0;
    const processCalls: Array<{ kind: string; chatId: string }> = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prepareTurn: () => ({ process: false, suppressReply: true, archive: true, rulesContext: "" }),
        processMedia: async (_msg, ctx) => {
          processCalls.push({ kind: ctx.kind, chatId: ctx.chatId });
          return { rawText: "текст из фото" };
        },
      },
    );

    const res = await bridge.handleUpdate(
      channelUpdate({
        text: undefined,
        caption: "фото",
        photo: [{ file_id: "p1", file_unique_id: "pu1" }],
      }),
    );
    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.deepEqual(processCalls, [{ kind: "photo", chatId: "-300" }]);
    assert.equal(agentCalls, 0);
  });

  it("channel_post с document → processMedia kind=document", async () => {
    const processCalls: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        prepareTurn: () => ({ process: false, suppressReply: true, archive: true, rulesContext: "" }),
        processMedia: async (_msg, ctx) => {
          processCalls.push(ctx.kind);
          return { rawText: undefined };
        },
      },
    );
    await bridge.handleUpdate(
      channelUpdate({
        text: undefined,
        document: { file_id: "d1", file_unique_id: "du1", file_name: "a.pdf", mime_type: "application/pdf" },
      }),
    );
    assert.deepEqual(processCalls, ["document"]);
  });

  it("pending-канал (groupConfigured=false) → тишина, без архива и агента", async () => {
    let agentCalls = 0;
    let processCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prepareTurn: (input) => {
          assert.equal(input.isChannel, true);
          return { process: false, suppressReply: false, archive: false, rulesContext: "" };
        },
        processMedia: async () => {
          processCalls++;
          return { rawText: "x" };
        },
      },
    );
    const res = await bridge.handleUpdate(
      channelUpdate({ groupConfigured: false, photo: [{ file_id: "p1" }] }),
    );
    assert.equal(res.handled, true);
    assert.equal(res.reason, "blocked-by-rules");
    assert.equal(processCalls, 0);
    assert.equal(agentCalls, 0);
  });

  it("channel_post без from и без sender_chat → no-user", async () => {
    const bridge = new TelegramBridge([42], async () => ({ text: "x" }), async () => undefined);
    const res = await bridge.handleUpdate({
      updateId: 1,
      updateKind: "channel_post",
      message: { chat: { id: -300, type: "channel" }, text: "x" },
    });
    assert.equal(res.handled, false);
    assert.equal(res.reason, "no-user");
  });

  it("channel_post /start не обрабатывается как команда (нет реального user)", async () => {
    const sent: string[] = [];
    const archives: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        prefilter: (input) => ({
          process: false,
          suppressReply: true,
          archive: input.isChannel === true,
        }),
        archiveHandler: async (msg) => {
          archives.push(msg.text ?? "");
          return { stored: true };
        },
      },
    );
    const res = await bridge.handleUpdate(channelUpdate({ text: "/start" }));
    assert.equal(res.reason, "archived-silent");
    assert.deepEqual(archives, ["/start"], "/start канала — обычный текст в архив");
    assert.equal(sent.length, 0);
  });
});

describe("edited-сообщения: ревизии архива (без дубликатов)", () => {
  it("archiveText: повторный текст с isEdited → ревизия++, дубликата нет", async () => {
    const repo = makeRepo();
    const svc = new ChatArchiveService(repo, new StubExtractor());
    const first = await svc.archiveText({
      chatId: -100,
      messageId: 77,
      fromUserId: 42,
      text: "оригинал",
    });
    assert.ok(first);
    assert.equal(first!.revision, 1);
    assert.equal(first!.isEdited, false);

    const edited = await svc.archiveText({
      chatId: -100,
      messageId: 77,
      fromUserId: 42,
      text: "исправлено",
      isEdited: true,
    });
    assert.ok(edited);
    assert.equal(edited!.id, first!.id, "та же запись, не дубликат");
    assert.equal(edited!.revision, 2);
    assert.equal(edited!.isEdited, true);
    assert.equal(edited!.rawText, "исправлено");
    assert.equal(repo.countArchive("-100"), 1);
  });

  it("bridge: edited_message с listener → архив получил обновлённый текст", async () => {
    const repo = makeRepo();
    const svc = new ChatArchiveService(repo, new StubExtractor());
    const archives: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        prefilter: (input) => ({
          process: false,
          suppressReply: true,
          archive: input.isGroup === true || input.isChannel === true,
        }),
        archiveHandler: async (msg) => {
          if (msg.text) {
            await svc.archiveText({
              chatId: msg.chat!.id!,
              threadId: msg.threadId,
              messageId: msg.messageId,
              fromUserId: msg.from?.id,
              text: msg.text,
              isEdited: msg.isEdited === true,
            });
          }
          archives.push(msg.text ?? "");
          return { stored: true };
        },
      },
    );

    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 42 }, chat: { id: -100, type: "supergroup" }, messageId: 90, text: "v1" },
    });
    await bridge.handleUpdate({
      updateId: 2,
      updateKind: "edited_message",
      message: {
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        messageId: 90,
        text: "v2",
        isEdited: true,
      },
    });
    assert.deepEqual(archives, ["v1", "v2"]);
    assert.equal(repo.countArchive("-100"), 1, "правка не создаёт дубликат");
    const rec = repo.findArchiveByMessageId("-100", "90");
    assert.equal(rec!.rawText, "v2");
    assert.equal(rec!.revision, 2);
    assert.equal(rec!.isEdited, true);
  });
});
