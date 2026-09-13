import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { runSetupCommand } from "../../.pi/extensions/chat-setup/handlers.js";
import type { ChatMemberStatus } from "../../.pi/extensions/telegram-bot/chat-auth.js";
import type { InlineButton } from "../../src/utils/telegram/session-files.js";

const tmpDirs: string[] = [];

interface FakeRules {
  replaceChatManagedRules(): void;
}

async function makeSetup(pending: number): Promise<ChatSetupService> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-cmd-"));
  tmpDirs.push(dir);
  const rules: FakeRules = { replaceChatManagedRules() {} };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  for (let i = 1; i <= pending; i++) {
    await setup.markPending({
      chatId: `-100${i}`,
      chatTitle: `Группа ${i}`,
      chatType: "group",
      addedByUserId: "42",
    });
  }
  return setup;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

const deps = (
  setup: ChatSetupService,
  sent: Array<{ chatId: number; text?: string; buttons?: InlineButton[][] }>,
  getChatMember?: (chatId: string, userId: string) => Promise<ChatMemberStatus>,
) => ({
  setup,
  users: { canManage: async () => true },
  sendMessage: async (
    chatId: number,
    text: string,
    extra?: { parseMode?: "HTML"; inlineButtons?: InlineButton[][] },
  ) => {
    sent.push({ chatId, text, buttons: extra?.inlineButtons });
  },
  getChatMember: getChatMember ?? (async () => "administrator"),
});

describe("runSetupCommand (D5 + группы)", () => {
  it("/setup в группе → «только в DM», keyboard не отправляется (R-GR-2)", async () => {
    const setup = await makeSetup(1);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "",
      { chatId: "-1001", userId: "42", isPrivate: false },
      deps(setup, sent),
    );
    assert.ok(text.includes("личных сообщениях"));
    assert.equal(sent.length, 0, "в группу keyboard не уходит");
  });

  it("/setup в DM → keyboard на каждый pending (≤5)", async () => {
    const setup = await makeSetup(2);
    const sent: Array<{ chatId: number; buttons?: InlineButton[][] }> = [];
    const text = await runSetupCommand("", { chatId: "42", userId: "42", isPrivate: true }, deps(setup, sent));
    assert.ok(text.includes("Групп в ожидании: 2"));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].chatId, 42);
    assert.ok(sent[0].buttons && sent[0].buttons.length > 0, "keyboard должен быть");
    assert.ok(sent[0].buttons![0][0].callbackData.startsWith("cs:-1001:"));
  });

  it("/setup <chatId> → один keyboard", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number; text: string; buttons?: InlineButton[][] }> = [];
    const text = await runSetupCommand("-1002", { chatId: "42", userId: "42", isPrivate: true }, deps(setup, sent));
    assert.ok(text.includes("«Группа 2»"));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].buttons![0][0].callbackData === "cs:-1002:p:team");
  });

  it("Пакет B: /setup <chatId> от чужого пользователя → group authority deny", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number }> = [];
    let memberChecked: Array<{ chatId: string; userId: string }> = [];
    const text = await runSetupCommand(
      "-1002",
      { chatId: "99", userId: "99", isPrivate: true },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
        // Реальная модель: actor — обычный member группы.
        getChatMember: async (chatId, userId) => {
          memberChecked.push({ chatId, userId });
          return "member";
        },
      },
    );
    assert.ok(text.includes("Нужны права администратора группы"));
    assert.equal(sent.length, 0, "keyboard не должен уйти чужому");
    assert.equal(memberChecked.length, 1, "getChatMember реально вызывался");
    assert.equal(memberChecked[0].chatId, "-1002", "проверялась именно target-группа");
  });

  it("P01: Telegram group creator + /setup <chatId> → allow", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number; buttons?: InlineButton[][] }> = [];
    const text = await runSetupCommand("-1002", { chatId: "99", userId: "99", isPrivate: true }, {
      setup,
      users: { canManage: async () => false },
      sendMessage: async (
        chatId: number,
        t: string,
        extra?: { parseMode?: "HTML"; inlineButtons?: InlineButton[][] },
      ) => {
        sent.push({ chatId, buttons: extra?.inlineButtons });
      },
      getChatMember: async () => "creator",
    });
    assert.ok(text.includes("«Группа 2»"));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].buttons![0][0].callbackData === "cs:-1002:p:team");
  });

  it("P01: Telegram group administrator + /setup <chatId> → allow", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number; buttons?: InlineButton[][] }> = [];
    const text = await runSetupCommand("-1002", { chatId: "99", userId: "99", isPrivate: true }, {
      setup,
      users: { canManage: async () => false },
      sendMessage: async (
        chatId: number,
        t: string,
        extra?: { parseMode?: "HTML"; inlineButtons?: InlineButton[][] },
      ) => {
        sent.push({ chatId, buttons: extra?.inlineButtons });
      },
      getChatMember: async () => "administrator",
    });
    assert.ok(text.includes("«Группа 2»"));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].buttons![0][0].callbackData === "cs:-1002:p:team");
  });

  it("P01: global owner + /setup <chatId> → allow даже без админства в группе", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number }> = [];
    // canManage=true; getChatMember бросает — но для manager он не должен вызываться.
    let checked = 0;
    const text = await runSetupCommand(
      "-1002",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, sent, async () => {
        checked++;
        throw new Error("must not be called");
      }),
    );
    assert.ok(text.includes("«Группа 2»"));
    assert.equal(sent.length, 1);
    assert.equal(checked, 0);
  });

  it("P01: admin ДРУГОЙ группы не может настроить чужую pending-группу", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1002",
      { chatId: "99", userId: "99", isPrivate: true },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
        // actor — administrator только в -1001, в target -1002 — member.
        getChatMember: async (chatId) => (chatId === "-1001" ? "administrator" : "member"),
      },
    );
    assert.ok(text.includes("Нужны права администратора группы"));
    assert.equal(sent.length, 0);
  });

  it("P01: blocked user → deny", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1002",
      { chatId: "66", userId: "66", isPrivate: true },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
        getChatMember: async () => "member",
      },
    );
    assert.ok(text.includes("Нужны права администратора группы"));
    assert.equal(sent.length, 0);
  });

  it("P01: getChatMember error → deny (fail closed)", async () => {
    const setup = await makeSetup(3);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1002",
      { chatId: "99", userId: "99", isPrivate: true },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
        getChatMember: async () => {
          throw new Error("network down");
        },
      },
    );
    assert.ok(text.includes("Не удалось проверить права"));
    assert.equal(sent.length, 0);
  });

  it("P01: pending missing chat → существующая ошибка", async () => {
    const setup = await makeSetup(1);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1009",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, sent),
    );
    assert.ok(text.includes("не в статусе pending"));
    assert.equal(sent.length, 0);
  });

  it("P01: completed chat → «не в статусе pending» (поведение сохранено)", async () => {
    const setup = await makeSetup(2);
    await setup.markCompleted("-1001", "team");
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1001",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, sent),
    );
    assert.ok(text.includes("не в статусе pending"));
    assert.equal(sent.length, 0);
  });

  it("P01: skipped chat → «не в статусе pending» (поведение сохранено)", async () => {
    const setup = await makeSetup(2);
    await setup.markSkipped("-1001");
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand(
      "-1001",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, sent),
    );
    assert.ok(text.includes("не в статусе pending"));
    assert.equal(sent.length, 0);
  });

  it("не canManage → отказ", async () => {
    const setup = await makeSetup(1);
    const text = await runSetupCommand(
      "",
      { chatId: "42", userId: "99", isPrivate: true },
      {
        setup,
        users: { canManage: async () => false },
        sendMessage: async () => undefined,
      },
    );
    assert.ok(text.includes("Недостаточно прав"));
  });
});
