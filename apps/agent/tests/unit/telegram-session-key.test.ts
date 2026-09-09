import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTelegramSessionKey, sanitizeDirSegment } from "../../.pi/extensions/telegram-bot/session-key.js";

describe("buildTelegramSessionKey (D2)", () => {
  it("стабильность: одинаковый вход → одинаковый ключ", () => {
    const a = buildTelegramSessionKey({ userId: 42, chatId: -100 });
    const b = buildTelegramSessionKey({ userId: "42", chatId: "-100" });
    assert.equal(a, b);
    assert.equal(a, "tg:42:-100");
  });

  it("разные chatId → разные ключи", () => {
    assert.notEqual(
      buildTelegramSessionKey({ userId: 42, chatId: -100 }),
      buildTelegramSessionKey({ userId: 42, chatId: -200 }),
    );
  });

  it("тема форума изолирована", () => {
    assert.equal(
      buildTelegramSessionKey({ userId: 42, chatId: -100, threadId: "15" }),
      "tg:42:-100:t:15",
    );
    assert.notEqual(
      buildTelegramSessionKey({ userId: 42, chatId: -100, threadId: "15" }),
      buildTelegramSessionKey({ userId: 42, chatId: -100 }),
    );
  });

  it("без chatId → dm", () => {
    assert.equal(buildTelegramSessionKey({ userId: 7 }), "tg:7:dm");
  });

  it("sanitizeDirSegment убирает traversal", () => {
    assert.equal(sanitizeDirSegment("../etc"), "___etc");
    assert.equal(sanitizeDirSegment("a/b"), "a_b");
    assert.equal(sanitizeDirSegment("-100"), "-100");
  });
});
