/**
 * Group ACL by membership (A1–A4): group = getChatMember-статус, private =
 * только явный список (open-режим НЕ пускает). Плюс sourceChatId для tools.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveTelegramAccess,
  IN_GROUP_STATUSES,
  type TelegramAccessDeps,
} from "../../.pi/extensions/telegram-bot/telegram-acl.js";
import { UsersService } from "../../src/services/UsersService.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import {
  assertCanReadChat,
  type GroupAccessDeps,
} from "../../src/services/documents/groupHistoryTools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// ── A2: isAllowedPrivate (закрытая личка, open-режим не пускает) ───────────

describe("UsersService.isAllowedPrivate (A2)", () => {
  function makeUsers(users: Array<{ id: string; role: "owner" | "admin" | "user" | "blocked" }>): UsersService {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acl-u-"));
    tmpDirs.push(dir);
    const svc = new UsersService(path.join(dir, "users.json"), { aclMode: "open" });
    return svc;
  }

  it("open mode НЕ пускает постороннего в DM", async () => {
    const svc = makeUsers([]);
    assert.equal(await svc.isAllowedPrivate("42"), false);
    assert.equal(await svc.isAllowed("42"), true, "глобальный open по-прежнему открыт (не-telegram пути)");
  });

  it("заведённый пользователь → true", async () => {
    const svc = makeUsers([{ id: "42", role: "user" }]);
    await svc.add({ id: "42", role: "user" });
    assert.equal(await svc.isAllowedPrivate("42"), true);
  });

  it("blocked → false даже в списке", async () => {
    const svc = makeUsers([{ id: "42", role: "blocked" }]);
    await svc.add({ id: "42", role: "blocked" });
    assert.equal(await svc.isAllowedPrivate("42"), false);
  });
});

// ── A1/A3/A4: resolveTelegramAccess ────────────────────────────────────────

describe("resolveTelegramAccess", () => {
  const deps = (over: Partial<TelegramAccessDeps> = {}): TelegramAccessDeps => ({
    isAllowedPrivate: async () => false,
    getChatMember: async () => ({ status: "member" }),
    ...over,
  });

  it("private: isAllowedPrivate=false → acl-denied (open-mode роли не играет)", async () => {
    const res = await resolveTelegramAccess(
      { userId: 1, chatId: 1, chatType: "private", hasRealUser: true },
      deps({ isAllowedPrivate: async () => false }),
    );
    assert.deepEqual(res, { allowed: false, reason: "acl-denied" });
  });

  it("private: isAllowedPrivate=true → ok", async () => {
    const res = await resolveTelegramAccess(
      { userId: 1, chatId: 1, chatType: "private", hasRealUser: true },
      deps({ isAllowedPrivate: async () => true }),
    );
    assert.deepEqual(res, { allowed: true, reason: "ok" });
  });

  it("group: member → ok, whitelist (isAllowedPrivate) вообще не вызывается", async () => {
    let privateCalls = 0;
    const res = await resolveTelegramAccess(
      { userId: 777, chatId: -100, chatType: "supergroup", hasRealUser: true },
      deps({
        isAllowedPrivate: async () => {
          privateCalls++;
          return false; // даже если бы в списке не было
        },
        getChatMember: async () => ({ status: "member" }),
      }),
    );
    assert.deepEqual(res, { allowed: true, reason: "ok" });
    assert.equal(privateCalls, 0, "group ACL не смотрит в users.json");
  });

  for (const status of ["left", "kicked", "unknown"]) {
    it(`group: status ${status} → deny (fail closed, A3)`, async () => {
      const res = await resolveTelegramAccess(
        { userId: 777, chatId: -100, chatType: "supergroup", hasRealUser: true },
        deps({ getChatMember: async () => ({ status }) }),
      );
      assert.equal(res.allowed, false);
      assert.equal(res.reason, "not-in-group");
    });
  }

  it("group: getChatMember throw → deny (A3)", async () => {
    const res = await resolveTelegramAccess(
      { userId: 777, chatId: -100, chatType: "group", hasRealUser: true },
      deps({
        getChatMember: async () => {
          throw new Error("network");
        },
      }),
    );
    assert.deepEqual(res, { allowed: false, reason: "get-chat-member-error" });
  });

  it("group: нет getChatMember → deny (fail closed)", async () => {
    const res = await resolveTelegramAccess(
      { userId: 777, chatId: -100, chatType: "group", hasRealUser: true },
      { isAllowedPrivate: async () => true },
    );
    assert.deepEqual(res, { allowed: false, reason: "not-in-group" });
  });

  it("без реального from (channel_post/sender_chat) → channel-no-user (A4)", async () => {
    const res = await resolveTelegramAccess(
      { userId: 0, chatId: -100, chatType: "channel", hasRealUser: false },
      deps(),
    );
    assert.deepEqual(res, { allowed: false, reason: "channel-no-user" });
  });

  it("IN_GROUP_STATUSES покрывает creator/administrator/member/restricted", () => {
    assert.deepEqual(
      [...IN_GROUP_STATUSES].sort(),
      ["administrator", "creator", "member", "restricted"].sort(),
    );
  });
});

// ── Bridge: membership-ACL end-to-end ──────────────────────────────────────

describe("TelegramBridge checkAgentAcl с telegramAccess", () => {
  it("group member без записи в whitelist → агент вызван (FR-1)", async () => {
    let agentCalls = 0;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123], // whitelist БЕЗ 777
      async () => {
        agentCalls++;
        return { text: "ответ" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        // Legacy whitelist вернул бы false — membership должен победить.
        aclCheck: async (userId) => userId === "123",
        telegramAccess: {
          isAllowedPrivate: async () => false,
          getChatMember: async () => ({ status: "member" }),
        },
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      message: {
        from: { id: 777 },
        chat: { id: -100, type: "supergroup" },
        text: "привет",
        botMentioned: true,
      },
    });
    assert.equal(res.handled, true);
    assert.equal(agentCalls, 1);
    assert.deepEqual(sent, ["ответ"]);
  });

  it("group: left → silent, без LLM (FR-2)", async () => {
    let agentCalls = 0;
    let sent = 0;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => {
        sent++;
      },
      {
        telegramAccess: {
          isAllowedPrivate: async () => false,
          getChatMember: async () => ({ status: "left" }),
        },
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 2,
      message: {
        from: { id: 777 },
        chat: { id: -100, type: "supergroup" },
        text: "привет",
        botMentioned: true,
      },
    });
    assert.equal(res.handled, true);
    assert.equal(agentCalls, 0);
    assert.equal(sent, 0, "в группе — молча");
  });

  it("stranger DM → «Нет доступа.», без LLM (FR-3)", async () => {
    let agentCalls = 0;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        telegramAccess: {
          isAllowedPrivate: async () => false,
          getChatMember: async () => ({ status: "member" }),
        },
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 3,
      message: { from: { id: 999 }, chat: { id: 999, type: "private" }, text: "привет" },
    });
    assert.equal(res.handled, true);
    assert.equal(agentCalls, 0);
    assert.deepEqual(sent, ["Нет доступа."]);
  });

  it("owner DM → ok", async () => {
    let agentCalls = 0;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalls++;
        return { text: "ок" };
      },
      async () => undefined,
      {
        telegramAccess: {
          isAllowedPrivate: async (userId) => userId === "123",
          getChatMember: async () => ({ status: "member" }),
        },
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 4,
      message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text: "привет" },
    });
    assert.equal(res.handled, true);
    assert.equal(agentCalls, 1);
  });
});

// ── §4: tools ACL — member своей группы читает историю/расходы ─────────────

describe("assertCanReadChat с sourceChatId (§4)", () => {
  const deps = (over: Partial<GroupAccessDeps> = {}): GroupAccessDeps => ({
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => false, // member НЕ в users.json
    listConfiguredChatIds: async () => [],
    ...over,
  });

  it("member вызывает tool из своей группы (sourceChatId=chatId) → true", async () => {
    const ok = await assertCanReadChat("777", "-100", deps({ sourceChatId: "-100" }));
    assert.equal(ok, true);
  });

  it("чужой chatId без canManage/isAllowed → false", async () => {
    const ok = await assertCanReadChat("777", "-200", deps({ sourceChatId: "-100" }));
    assert.equal(ok, false);
  });

  it("не configured → false даже со sourceChatId", async () => {
    const ok = await assertCanReadChat(
      "777",
      "-100",
      deps({ sourceChatId: "-100", isConfiguredSync: () => false }),
    );
    assert.equal(ok, false);
  });

  it("без sourceChatId — прежнее поведение (isAllowed/canManage)", async () => {
    assert.equal(await assertCanReadChat("777", "-100", deps({})), false);
    assert.equal(
      await assertCanReadChat("777", "-100", deps({ canManage: async () => true })),
      true,
    );
  });
});
