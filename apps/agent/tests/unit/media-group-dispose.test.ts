/**
 * P05: альбомы не теряются молча при shutdown — dispose() флашит pending.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MediaGroupBuffer,
  type AlbumBatch,
  type AlbumItem,
} from "../../.pi/extensions/telegram-bot/media-group-buffer.js";
import {
  TelegramBridge,
  type GrishaAgent,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

function item(updateId: number, fileId: string): AlbumItem {
  return {
    updateId,
    messageId: updateId,
    fileId,
    fileUniqueId: `u${updateId}`,
    kind: "photo",
  };
}

describe("MediaGroupBuffer.dispose (P05)", () => {
  it("pending альбом → dispose флашит одним батчем", async () => {
    const flushed: AlbumBatch[] = [];
    const buf = new MediaGroupBuffer(60_000, async (batch) => {
      flushed.push(batch);
    });
    buf.add("g1", item(1, "f1"));
    buf.add("g1", item(2, "f2"));
    assert.equal(buf.pendingCount(), 1);
    await buf.dispose();
    assert.equal(buf.pendingCount(), 0);
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].groupId, "g1");
    assert.equal(flushed[0].items.length, 2);
  });

  it("два альбома → два батча", async () => {
    const flushed: AlbumBatch[] = [];
    const buf = new MediaGroupBuffer(60_000, async (batch) => {
      flushed.push(batch);
    });
    buf.add("g1", item(1, "f1"));
    buf.add("g2", item(2, "f2"));
    await buf.dispose();
    assert.equal(flushed.length, 2);
  });

  it("без pending → onFlush не вызывается", async () => {
    let called = 0;
    const buf = new MediaGroupBuffer(10, async () => {
      called++;
    });
    await buf.dispose();
    assert.equal(called, 0);
  });

  it("flush failure → dispose не бросает (лог только)", async () => {
    const buf = new MediaGroupBuffer(60_000, async () => {
      throw new Error("pipeline down");
    });
    buf.add("g1", item(1, "f1"));
    await buf.dispose();
    assert.equal(buf.pendingCount(), 0);
  });

  it("таймер отменяется при dispose (не срабатывает второй раз)", async () => {
    const flushed: AlbumBatch[] = [];
    const buf = new MediaGroupBuffer(15, async (batch) => {
      flushed.push(batch);
    });
    buf.add("g1", item(1, "f1"));
    await buf.dispose();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(flushed.length, 1, "ровно один флаш");
  });
});

describe("bridge dispose → альбом флашится (P05)", () => {
  it("альбом в буфере + bridge.dispose() → processMediaAlbum один раз", async () => {
    const batches: AlbumBatch[] = [];
    const agentCalls: string[] = [];
    const agent: GrishaAgent = async (input) => {
      agentCalls.push(input.message);
      return { text: "ок" };
    };
    const bridge = new TelegramBridge([], agent, async () => undefined, {
      albumBufferMs: 60_000,
      processMediaAlbum: async (batch) => {
        batches.push(batch);
        return {};
      },
      telegramAccess: {
        isAllowedPrivate: async () => false,
        getChatMember: async () => ({ status: "administrator" }),
      },
    });
    await bridge.handleUpdate({
      updateId: 1,
      message: {
        from: { id: 7 },
        chat: { id: -1001, type: "supergroup" },
        mediaGroupId: "gal",
        photo: [{ file_id: "fa" }, { file_id: "fb" }],
      },
    });
    assert.equal(agentCalls.length, 0, "в буфере, агента ещё нет");
    await bridge.dispose();
    assert.equal(batches.length, 1);
    assert.equal(agentCalls.length, 1, "флаш дошёл до агента");
  });
});
