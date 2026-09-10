/**
 * maybeIngestDocument — force/skipAck (B3): mention-mode не блокирует
 * force-путь (listener / archive_ocr_ingest), ACL действует всегда.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maybeIngestDocument } from "../../src/services/documents/telegram.js";
import type { TelegramFileMessage } from "../../src/services/documents/DocumentIngestService.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const msg = (extra: Partial<TelegramFileMessage> = {}): TelegramFileMessage => ({
  chat: { id: -100, type: "supergroup" },
  from: { id: 42 },
  messageId: 7,
  ...extra,
});

function deps(mode = "mention", ingested: ExpenseDocument[] = []) {
  return {
    getIngestMode: () => mode,
    isAllowed: async () => true,
    ingest: async (m: TelegramFileMessage) => {
      const doc: ExpenseDocument = {
        id: "d1",
        chatId: String(m.chat.id),
        kind: "receipt",
        docDate: "2026-09-10",
        supplier: "Ромашка",
        total: 100,
        currency: "RUB",
        confidence: 0.5,
        needsReview: false,
        source: "telegram",
        createdAt: "t",
        updatedAt: "t",
      };
      ingested.push(doc);
      return doc;
    },
  };
}

describe("maybeIngestDocument (force/skipAck)", () => {
  it("mode=mention без mention/reply/ключа → инжест не бежит", async () => {
    const calls: ExpenseDocument[] = [];
    const res = await maybeIngestDocument(msg({ photo: [{ file_id: "p1" }] }), deps("mention", calls));
    assert.equal(res, null);
    assert.equal(calls.length, 0);
  });

  it("mode=mention + force → инжест бежит (mention не блокирует force)", async () => {
    const calls: ExpenseDocument[] = [];
    const res = await maybeIngestDocument(
      msg({ photo: [{ file_id: "p1" }] }),
      deps("mention", calls),
      { force: true },
    );
    assert.ok(res?.ack, "ack возвращается");
    assert.equal(calls.length, 1);
  });

  it("skipAck: инжест выполнен, ack не возвращается (тихий фон)", async () => {
    const calls: ExpenseDocument[] = [];
    const res = await maybeIngestDocument(
      msg({ photo: [{ file_id: "p1" }] }),
      deps("mention", calls),
      { force: true, skipAck: true },
    );
    assert.equal(res, null);
    assert.equal(calls.length, 1, "сам инжест выполнен");
  });

  it("ACL действует и при force", async () => {
    const calls: ExpenseDocument[] = [];
    const res = await maybeIngestDocument(
      msg({ photo: [{ file_id: "p1" }] }),
      { ...deps("mention", calls), isAllowed: async () => false },
      { force: true },
    );
    assert.equal(res, null);
    assert.equal(calls.length, 0);
  });

  it("без файла → null даже с force", async () => {
    const res = await maybeIngestDocument(msg({}), deps("mention"), { force: true });
    assert.equal(res, null);
  });
});
