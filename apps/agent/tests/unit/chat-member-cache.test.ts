/**
 * P04: TTL-кэш getChatMember — только успехи, ошибки не кэшируются (fail closed),
 * TTL, отдельные записи на chat/user, инвалидация чата.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChatMemberTtlCache } from "../../.pi/extensions/telegram-bot/chat-member-cache.js";

describe("ChatMemberTtlCache", () => {
  it("first → API, second → cache", async () => {
    let apiCalls = 0;
    const cache = new ChatMemberTtlCache();
    const raw = cache.wrap(async () => {
      apiCalls++;
      return { status: "member" };
    });
    assert.deepEqual(await raw(-100, 7), { status: "member" });
    assert.deepEqual(await raw(-100, 7), { status: "member" });
    assert.equal(apiCalls, 1);
  });

  it("после TTL → снова API", async () => {
    let apiCalls = 0;
    let now = 1_000;
    const cache = new ChatMemberTtlCache(90_000, () => now);
    const raw = cache.wrap(async () => {
      apiCalls++;
      return { status: "administrator" };
    });
    await raw(-100, 7);
    now += 89_000;
    await raw(-100, 7);
    assert.equal(apiCalls, 1, "внутри TTL — кэш");
    now += 2_000;
    await raw(-100, 7);
    assert.equal(apiCalls, 2, "после TTL — API");
  });

  it("API failure → проброс и НЕ кэшируется (fail closed)", async () => {
    let apiCalls = 0;
    const cache = new ChatMemberTtlCache();
    const raw = cache.wrap(async () => {
      apiCalls++;
      throw new Error("api down");
    });
    await assert.rejects(() => raw(-100, 7), /api down/);
    await assert.rejects(() => raw(-100, 7), /api down/);
    assert.equal(apiCalls, 2, "ошибка не закэширована");
  });

  it("разные user / разные chat → отдельные записи", async () => {
    let apiCalls = 0;
    const cache = new ChatMemberTtlCache();
    const raw = cache.wrap(async () => {
      apiCalls++;
      return { status: "member" };
    });
    await raw(-100, 1);
    await raw(-100, 2);
    await raw(-200, 1);
    assert.equal(apiCalls, 3);
    assert.equal(cache.size(), 3);
  });

  it("invalidateChat чистит все записи чата", async () => {
    const cache = new ChatMemberTtlCache();
    const raw = cache.wrap(async (chatId, userId) => ({
      status: chatId === -100 ? "member" : "creator",
    }));
    await raw(-100, 1);
    await raw(-100, 2);
    await raw(-200, 1);
    assert.equal(cache.size(), 3);
    cache.invalidateChat(-100);
    assert.equal(cache.size(), 1);
    const res = await raw(-100, 1);
    assert.deepEqual(res, { status: "member" });
    assert.equal(cache.size(), 2);
  });

  it("invalidate удаляет конкретную запись", async () => {
    const cache = new ChatMemberTtlCache();
    const raw = cache.wrap(async () => ({ status: "member" }));
    await raw(-100, 1);
    await raw(-100, 2);
    cache.invalidate(-100, 1);
    assert.equal(cache.size(), 1);
  });
});
