import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { onChatMemberAdded, handleSetupCallback, tryHandleCustomText } from "../../.pi/extensions/chat-setup/handlers.js";
import type { ManagedRuleInput } from "../../.pi/extensions/user-rules/UserRulesService.js";

const tmpDirs: string[] = [];

interface FakeRules {
  replaced: Array<{ chatId: string; rules: ManagedRuleInput[]; meta: { source: string; actorId: string } }>;
  replaceChatManagedRules(chatId: string, rules: ManagedRuleInput[], meta: { source: string; actorId: string }): void;
}

function makeSetup(): { setup: ChatSetupService; rules: FakeRules; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-setup-"));
  tmpDirs.push(dir);
  const rules: FakeRules = {
    replaced: [],
    replaceChatManagedRules(chatId, r, meta) {
      this.replaced.push({ chatId, rules: r, meta });
    },
  };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup, rules, dir };
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("ChatSetupService", () => {
  it("markPending → get returns pending", async () => {
    const { setup } = makeSetup();
    await setup.markPending({
      chatId: "-100",
      chatTitle: "Отдел",
      chatType: "group",
      addedByUserId: "42",
    });
    const rec = await setup.get("-100");
    assert.equal(rec?.status, "pending");
    assert.equal(rec?.addedByUserId, "42");
  });

  it("applyPreset team → replaceChatManagedRules c require_mention true", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    await setup.applyPreset("-100", "team", { actorId: "42" });

    assert.equal(rules.replaced.length, 1);
    const { chatId, rules: replaced, meta } = rules.replaced[0];
    assert.equal(chatId, "-100");
    assert.equal(meta.source, "preset:team");
    assert.equal(meta.actorId, "42");
    const requireMention = replaced.find((r) => r.key === "require_mention");
    assert.equal(requireMention?.value, true);

    const rec = await setup.get("-100");
    assert.equal(rec?.status, "completed");
    assert.equal(rec?.presetId, "team");
  });

  it("applyPreset only_me → includes only_my_messages_user_id = actor", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "7" });
    await setup.applyPreset("-100", "only_me", { actorId: "7" });
    const userIdRule = rules.replaced[0].rules.find((r) => r.key === "only_my_messages_user_id");
    assert.equal(userIdRule?.value, "7");
  });

  it("applyPreset silent (safe_default) keeps status pending", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.applyPreset("-100", "safe_default", { actorId: "1", silent: true });
    assert.equal((await setup.get("-100"))?.status, "pending");
  });

  it("markSkipped → status skipped", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markSkipped("-100");
    assert.equal((await setup.get("-100"))?.status, "skipped");
  });

  it("custom flow: waiting → setPendingRules → confirmCustom replaces rules", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "5" });
    await setup.beginCustom("-100", "5");
    assert.equal((await setup.getWaitingForActor("5"))?.chatId, "-100");

    await setup.setPendingRules("-100", [{ key: "length", value: "short", kind: "soft" }]);
    await setup.confirmCustom("-100", "5");
    assert.equal(rules.replaced.length, 1);
    assert.equal(rules.replaced[0].meta.source, "custom");
    assert.equal((await setup.get("-100"))?.status, "completed");
    assert.equal((await setup.get("-100"))?.presetId, "custom");
  });

  it("persists to disk: новый инстанс видит запись", async () => {
    const { setup, dir } = makeSetup();
    await setup.markPending({ chatId: "-42", chatType: "supergroup", addedByUserId: "9" });
    const rules2: FakeRules = { replaced: [], replaceChatManagedRules() {} };
    const setup2 = new ChatSetupService(
      path.join(dir, "chat-setup.json"),
      rules2 as unknown as UserRulesService,
    );
    assert.equal((await setup2.get("-42"))?.status, "pending");
  });

  it("isConfiguredSync: no record → false; pending → false; completed/skipped → true", async () => {
    const { setup } = makeSetup();
    assert.equal(setup.isConfiguredSync("-100"), false);

    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    assert.equal(setup.isConfiguredSync("-100"), false, "pending — ещё silent");

    await setup.applyPreset("-100", "safe_default", { actorId: "1", silent: true });
    assert.equal(setup.isConfiguredSync("-100"), false, "safe_default НЕ завершает настройку");

    await setup.markCompleted("-100", "team");
    assert.equal(setup.isConfiguredSync("-100"), true);

    await setup.markPending({ chatId: "-200", chatType: "group", addedByUserId: "1" });
    await setup.markSkipped("-200");
    assert.equal(setup.isConfiguredSync("-200"), true);
  });
});

describe("onboarding handlers", () => {
  const deps = (setup: ChatSetupService, rules: FakeRules) => ({
    setup,
    users: { canManage: async () => true } as unknown as { canManage(userId: string | number): Promise<boolean> },
    sendMessage: async () => undefined,
    rules,
  });

  it("my_chat_member → safe_default + pending + DM с кнопками (R-GR-2: в группу НЕ пишем)", async () => {
    const { setup, rules } = makeSetup();
    const sent: Array<{ chatId: number; text: string; hasButtons: boolean }> = [];
    await onChatMemberAdded(
      {
        oldStatus: "left",
        newStatus: "member",
        chat: { id: -100, type: "group", title: "Отдел продаж" },
        from: { id: 42 },
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async (chatId, text, extra) => {
          sent.push({ chatId, text, hasButtons: (extra?.inlineButtons?.length ?? 0) > 0 });
        },
      },
    );

    assert.equal(rules.replaced.length, 1);
    assert.equal(rules.replaced[0].meta.source, "preset:safe_default");
    assert.equal((await setup.get("-100"))?.status, "pending");
    assert.equal(sent.length, 1, "только DM, без сообщения в группу");
    assert.equal(sent[0].chatId, 42);
    assert.ok(sent[0].text.includes("Отдел продаж"));
    assert.ok(sent[0].hasButtons, "кнопки пресетов — в DM");
  });

  it("second add after completed → no DM, no rule rewrite", async () => {
    const { setup, rules } = makeSetup();
    const sent: string[] = [];
    const depsLocal = {
      setup,
      users: { canManage: async () => true },
      sendMessage: async (chatId: number, text: string) => {
        sent.push(`${chatId}`);
      },
    };
    await onChatMemberAdded(
      { oldStatus: "left", newStatus: "member", chat: { id: -100, type: "group", title: "T" }, from: { id: 42 } },
      depsLocal,
    );
    await setup.markCompleted("-100", "team");
    const replacedAfter = rules.replaced.length;

    await onChatMemberAdded(
      { oldStatus: "kicked", newStatus: "administrator", chat: { id: -100, type: "group", title: "T" }, from: { id: 42 } },
      depsLocal,
    );

    assert.equal(rules.replaced.length, replacedAfter);
    assert.equal(sent.length, 1, "повторный add не спамит (первый add: только DM)");
  });

  it("DM упал → один короткий fallback в группу БЕЗ кнопок (R-GR-2)", async () => {
    const { setup, rules } = makeSetup();
    const toActor: string[] = [];
    const toGroup: Array<{ chatId: number; text: string; hasButtons: boolean }> = [];
    await onChatMemberAdded(
      { oldStatus: "left", newStatus: "member", chat: { id: -100, type: "group", title: "T" }, from: { id: 42 } },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async (chatId, text, extra) => {
          if (chatId === 42) {
            toActor.push(text);
            throw new Error("can't DM");
          }
          toGroup.push({ chatId, text, hasButtons: (extra?.inlineButtons?.length ?? 0) > 0 });
        },
      },
    );

    assert.equal(toActor.length, 1, "DM попытка была ровно одна");
    assert.equal(toGroup.length, 1, "fallback в группу ровно один");
    assert.ok(toGroup[0].text.includes("/setup"), "короткая строка с подсказкой");
    assert.ok(!toGroup[0].text.includes("Выберите сценарий"), "без меню пресетов");
    assert.equal(toGroup[0].hasButtons, false, "без кнопок пресетов");
    assert.equal(rules.replaced.length, 1, "safe_default всё равно применён");
    assert.equal(setup.isConfiguredSync("-100"), false, "fallback не завершает настройку");
  });

  it("FR-8: повторный add при pending не дублирует онбординг", async () => {
    const { setup, rules } = makeSetup();
    const sent: number[] = [];
    const depsLocal = {
      setup,
      users: { canManage: async () => true },
      sendMessage: async (chatId: number) => {
        sent.push(chatId);
      },
    };
    const base = {
      oldStatus: "left",
      newStatus: "member",
      chat: { id: -100, type: "group", title: "T" },
      from: { id: 42 },
    };
    await onChatMemberAdded(base, depsLocal);
    assert.equal(sent.length, 1, "первый add: только DM");

    // Бота кикнули и вернули (статус всё ещё pending) — онбординг не дублируется.
    await onChatMemberAdded(
      { ...base, oldStatus: "kicked", newStatus: "administrator" },
      depsLocal,
    );
    assert.equal(sent.length, 1, "повторный add при pending не спамит");
    assert.equal(rules.replaced.length, 2, "safe_default переприменён идемпотентно");
  });

  it("callback p:team от canManage-actor применяет пресет и редактирует сообщение", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    const edits: string[] = [];
    const handled = await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 42 },
        answerCallbackQuery: async () => undefined,
        editMessageText: async (text) => {
          edits.push(text);
        },
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async () => undefined,
        getChatMember: async () => "administrator",
      },
    );
    assert.equal(handled, true);
    assert.equal(rules.replaced[0].meta.source, "preset:team");
    assert.equal((await setup.get("-100"))?.status, "completed");
    assert.ok(edits[0].includes("Участник команды"));
  });

  it("callback от постороннего (не canManage, не addedBy) → Недостаточно прав", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    const alerts: string[] = [];
    await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 999 },
        answerCallbackQuery: async (_t, extra) => {
          alerts.push(extra?.showAlert ? "alert" : "no");
        },
        editMessageText: async () => undefined,
      },
      { setup, users: { canManage: async () => false }, sendMessage: async () => undefined },
    );
    assert.equal(rules.replaced.length, 0);
    assert.deepEqual(alerts, ["alert"]);
  });

  it("Пакет B: member (не админ, не canManage) → alert 'Нужны права администратора', пресет НЕ применён", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    const alerts: Array<{ text: string; alert: boolean }> = [];
    let memberChecked = 0;
    const handled = await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 42 },
        answerCallbackQuery: async (text, extra) => {
          alerts.push({ text: text ?? "", alert: extra?.showAlert ?? false });
        },
        editMessageText: async () => undefined,
      },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
        getChatMember: async (chatId, userId) => {
          memberChecked++;
          assert.equal(chatId, "-100");
          assert.equal(userId, "42");
          return "member";
        },
      },
    );
    assert.equal(handled, true);
    assert.equal(memberChecked, 1, "getChatMember был вызван");
    assert.equal(rules.replaced.length, 0, "правила не менялись");
    assert.equal((await setup.get("-100"))?.status, "pending");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alert, true);
    assert.ok(alerts[0].text.includes("администратора"));
  });

  it("Пакет B: creator → пресет применяется", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    await handleSetupCallback(
      "cs:-100:p:secretary",
      {
        from: { id: 42 },
        answerCallbackQuery: async () => undefined,
        editMessageText: async () => undefined,
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async () => undefined,
        getChatMember: async () => "creator",
      },
    );
    assert.equal(rules.replaced[0].meta.source, "preset:secretary");
  });

  it("FR-4: member, но canManage (owner/admin бота) → пресет применяется", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 42 },
        answerCallbackQuery: async () => undefined,
        editMessageText: async () => undefined,
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async () => undefined,
        getChatMember: async () => "member",
      },
    );
    assert.equal(rules.replaced[0].meta.source, "preset:team");
    assert.equal((await setup.get("-100"))?.status, "completed");
  });

  it("Пакет B: getChatMember бросил (сеть) → fail closed, пресет НЕ применён", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    const alerts: string[] = [];
    await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 42 },
        answerCallbackQuery: async (text) => {
          alerts.push(text ?? "");
        },
        editMessageText: async () => undefined,
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async () => undefined,
        getChatMember: async () => {
          throw new Error("ETIMEDOUT");
        },
      },
    );
    assert.equal(rules.replaced.length, 0);
    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].includes("Не удалось проверить права"));
  });

  it("Пакет B: getChatMember 403 (бот кикнут) → 'Нужны права администратора'", async () => {
    const { setup, rules } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "42" });
    const alerts: string[] = [];
    await handleSetupCallback(
      "cs:-100:p:team",
      {
        from: { id: 42 },
        answerCallbackQuery: async (text) => {
          alerts.push(text ?? "");
        },
        editMessageText: async () => undefined,
      },
      {
        setup,
        users: { canManage: async () => true },
        sendMessage: async () => undefined,
        getChatMember: async () => {
          throw { error_code: 403, description: "Forbidden: bot was kicked" };
        },
      },
    );
    assert.equal(rules.replaced.length, 0);
    assert.ok(alerts[0].includes("администратора"));
  });

  it("custom text в DM: parse + pendingRules + кнопки confirm", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "5" });
    await setup.beginCustom("-100", "5");
    const sent: Array<{ chatId: number; text: string }> = [];
    const handled = await tryHandleCustomText(
      { userId: "5", chatId: "77", text: "Отвечай только на мои сообщения, кратко", isPrivate: true },
      { setup },
      async (chatId, text) => {
        sent.push({ chatId, text });
      },
    );
    assert.equal(handled, true);
    assert.equal(sent[0].chatId, 77);
    assert.ok(sent[0].text.includes("only_my_messages"));
    const rec = await setup.get("-100");
    assert.ok(rec?.pendingRules?.some((r) => r.key === "only_my_messages"));
  });

  it("custom text в группе (не DM) не перехватывается", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "5" });
    await setup.beginCustom("-100", "5");
    const handled = await tryHandleCustomText(
      { userId: "5", chatId: "-100", text: "привет", isPrivate: false },
      { setup },
      async () => undefined,
    );
    assert.equal(handled, false);
  });
});
