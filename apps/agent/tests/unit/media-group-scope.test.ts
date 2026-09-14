/**
 * PROMPT 10: composite-ключ MediaGroupBuffer — chatId + mediaGroupId.
 *
 * Инварианты:
 *  - альбомы одного чата остаются сгруппированными;
 *  - альбомы РАЗНЫХ чатов с одинаковым media_group_id НЕ делят состояние;
 *  - timeout/flush и cleanup-семантика сохранены;
 *  - groupId в batch остаётся сырым (agent message не меняется);
 *  - media processing semantics не тронуты.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MediaGroupBuffer,
  mediaGroupScopeKey,
  type AlbumItem,
} from "../../.pi/extensions/telegram-bot/media-group-buffer.js";
import { TelegramBridge, type TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

const item = (id: number, unique: string): AlbumItem => ({
  updateId: id,
  messageId: id,
  fileId: `f-${unique}`,
  fileUniqueId: unique,
  kind: "photo",
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("MediaGroupBuffer composite key (PROMPT 10)", () => {
  it("1. scope key: chatId + groupId", () => {
    assert.equal(mediaGroupScopeKey("-100", "g1"), "-100:g1");
    assert.notEqual(mediaGroupScopeKey("-100", "g1"), mediaGroupScopeKey("-200", "g1"));
    assert.notEqual(mediaGroupScopeKey("-100", "g1"), mediaGroupScopeKey("-100", "g2"));
  });

  it("2. одинаковый groupId в РАЗНЫХ чатах → отдельные batch'и", async () => {
    const flushes: Array<{ chatId: string; groupId: string; items: number }> = [];
    const buffer = new MediaGroupBuffer(20, async (batch) => {
      flushes.push({ chatId: batch.chatId, groupId: batch.groupId, items: batch.items.length });
    });
    buffer.add("-100", "g1", item(1, "a1"));
    buffer.add("-200", "g1", item(2, "b1"));
    buffer.add("-100", "g1", item(3, "a2"));
    await sleep(60);
    assert.equal(flushes.length, 2, "два чата — два флаша");
    const chatA = flushes.find((f) => f.chatId === "-100")!;
    const chatB = flushes.find((f) => f.chatId === "-200")!;
    assert.equal(chatA.groupId, "g1");
    assert.equal(chatA.items, 2, "элементы чата A сгруппированы");
    assert.equal(chatB.items, 1, "элемент чата B — отдельно, не смешан с A");
    buffer.dispose();
  });

  it("3. один чат + один groupId → один batch (существующее поведение)", async () => {
    const flushes: number[] = [];
    const buffer = new MediaGroupBuffer(20, async (batch) => {
      flushes.push(batch.items.length);
    });
    buffer.add("-100", "g1", item(1, "u1"));
    buffer.add("-100", "g1", item(2, "u2"));
    buffer.add("-100", "g1", item(3, "u3"));
    await sleep(60);
    assert.deepEqual(flushes, [3]);
    buffer.dispose();
  });

  it("4. dispose: pending очищается, flush после dispose не приходит", async () => {
    const flushes: string[] = [];
    const buffer = new MediaGroupBuffer(10, async (batch) => {
      flushes.push(batch.groupId);
    });
    buffer.add("-100", "g1", item(1, "u1"));
    assert.equal(buffer.pendingCount(), 1);
    buffer.dispose();
    assert.equal(buffer.pendingCount(), 0);
    await sleep(40);
    assert.deepEqual(flushes, [], "после dispose флаша нет");
  });

  it("5. timeout: повторный add сбрасывает таймер группы (семантика сохранена)", async () => {
    const flushes: string[] = [];
    const buffer = new MediaGroupBuffer(25, async (batch) => {
      flushes.push(batch.groupId);
    });
    buffer.add("-100", "g1", item(1, "u1"));
    await sleep(20);
    buffer.add("-100", "g1", item(2, "u2")); // сброс таймера
    await sleep(15);
    assert.deepEqual(flushes, [], "таймер сброшен — флаша ещё нет");
    await sleep(30);
    assert.deepEqual(flushes, ["g1"]);
    buffer.dispose();
  });
});

describe("bridge album scope (PROMPT 10)", () => {
  it("6. два чата с одинаковым mediaGroupId → два хода агента, ctx не смешивается", async () => {
    let agentCalls = 0;
    const albumCtx: Array<{ chatId: string; userId: string }> = [];
    const bridge = new TelegramBridge(
      [1],
      async () => {
        agentCalls++;
        return { text: "ок" };
      },
      async () => undefined,
      {
        aclCheck: async () => true,
        albumBufferMs: 20,
        processMediaAlbum: async (_batch, ctx) => {
          albumCtx.push({ chatId: ctx.chatId, userId: ctx.userId });
          return { rawText: "ocr" };
        },
      },
    );
    const update = (updateId: number, chatId: number, unique: string): TgUpdate => ({
      updateId,
      message: {
        from: { id: 1 },
        chat: { id: chatId, type: "supergroup" },
        groupConfigured: true,
        mediaGroupId: "same-group-id",
        photo: [{ file_id: `f${updateId}`, file_unique_id: unique }],
      },
    });
    await bridge.handleUpdate(update(1, -100, "a1"));
    await bridge.handleUpdate(update(2, -200, "b1"));
    await bridge.handleUpdate(update(3, -100, "a2"));
    await sleep(80);
    assert.equal(agentCalls, 2, "два чата — два альбомных хода");
    assert.deepEqual(
      albumCtx.sort((x, y) => x.chatId.localeCompare(y.chatId)),
      [
        { chatId: "-100", userId: "1" },
        { chatId: "-200", userId: "1" },
      ],
      "gate-контекст каждого чата свой",
    );
  });

  it("7. agent message сохраняет СЫРОЙ groupId (media semantics не тронуты)", async () => {
    const messages: string[] = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        messages.push(input.message);
        return { text: "ок" };
      },
      async () => undefined,
      {
        aclCheck: async () => true,
        albumBufferMs: 20,
        processMediaAlbum: async (batch) => ({ rawText: "ocr", archived: true }),
      },
    );
    await bridge.handleUpdate({
      updateId: 5,
      message: {
        from: { id: 1 },
        chat: { id: -100, type: "supergroup" },
        groupConfigured: true,
        mediaGroupId: "raw-g1",
        photo: [{ file_id: "f", file_unique_id: "u" }],
      },
    });
    await sleep(60);
    assert.equal(messages.length, 1);
    assert.ok(messages[0]!.includes("telegram_media_group_id: raw-g1"));
  });
});
