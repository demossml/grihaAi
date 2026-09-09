import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCanConfigureGroup,
  isGroupAdminStatus,
  mapChatMemberStatus,
} from "../../.pi/extensions/telegram-bot/chat-auth.js";

const users = { canManage: async () => true };

describe("assertCanConfigureGroup (Пакет B)", () => {
  it("administrator → ok", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => "administrator",
      users,
    });
    assert.deepEqual(res, { ok: true });
  });

  it("creator → ok", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => "creator",
      users,
    });
    assert.deepEqual(res, { ok: true });
  });

  it("member + canManage (owner/admin бота) → ok (FR-4)", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => "member",
      users: { canManage: async () => true },
    });
    assert.deepEqual(res, { ok: true });
  });

  it("member без canManage → deny", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => "member",
      users: { canManage: async () => false },
    });
    assert.deepEqual(res, { ok: false, reason: "Нужны права администратора группы." });
  });

  it("getChatMember throw (сеть) → deny fail-closed", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => {
        throw new Error("ETIMEDOUT");
      },
      users,
    });
    assert.equal(res.ok, false);
    assert.ok(res.ok === false && res.reason.includes("Не удалось проверить права"));
  });

  it("getChatMember 403 → deny 'нужны права'", async () => {
    const res = await assertCanConfigureGroup({
      chatId: "-100",
      userId: "42",
      getChatMember: async () => {
        throw { error_code: 403, description: "Forbidden" };
      },
      users,
    });
    assert.equal(res.ok, false);
    assert.ok(res.ok === false && res.reason.includes("администратора"));
  });
});

describe("status helpers", () => {
  it("isGroupAdminStatus", () => {
    assert.equal(isGroupAdminStatus("creator"), true);
    assert.equal(isGroupAdminStatus("administrator"), true);
    assert.equal(isGroupAdminStatus("member"), false);
    assert.equal(isGroupAdminStatus("unknown"), false);
  });

  it("mapChatMemberStatus", () => {
    assert.equal(mapChatMemberStatus("administrator"), "administrator");
    assert.equal(mapChatMemberStatus("kicked"), "kicked");
    assert.equal(mapChatMemberStatus("wat"), "unknown");
    assert.equal(mapChatMemberStatus(undefined), "unknown");
  });
});
