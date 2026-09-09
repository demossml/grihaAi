import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { runSetupCommand } from "../../.pi/extensions/chat-setup/handlers.js";
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
});

describe("runSetupCommand (D5)", () => {
  it("не-private → только текст, без send", async () => {
    const setup = await makeSetup(1);
    const sent: Array<{ chatId: number }> = [];
    const text = await runSetupCommand("", { chatId: "-1001", userId: "42", isPrivate: false }, deps(setup, sent));
    assert.ok(text.includes("личных сообщениях"));
    assert.equal(sent.length, 0);
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
