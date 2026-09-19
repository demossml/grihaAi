import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import {
  handleGroupCallback,
  runGroupsCommand,
  type GroupsDeps,
  type GroupsCallbackContext,
} from "../../.pi/extensions/chat-setup/groups.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "groups-"));
  tmpDirs.push(dir);
  const rules = {
    replaceChatManagedRules() {},
    getHardRules: () => [],
    getSoftRules: () => [],
  };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup, dir };
}

const deps = (setup: ChatSetupService, canManage: boolean): GroupsDeps => ({
  setup,
  users: { canManage: async () => canManage },
});

function ctx(id: number, opts: { alert?: (b: boolean) => void; edit?: (t: string) => void } = {}): GroupsCallbackContext {
  return {
    from: { id },
    answerCallbackQuery: async (_t, extra) => opts.alert?.(extra?.showAlert ?? false),
    editMessageText: async (text) => opts.edit?.(text),
  };
}

describe("runGroupsCommand (S6)", () => {
  it("canManage видит список групп", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    const text = await runGroupsCommand(
      "",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, true),
      async () => undefined,
    );
    assert.ok(text.includes("-100"), "список содержит чат");
  });

  it("посторонний (не canManage) → 'Нет доступа'", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    const text = await runGroupsCommand(
      "",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, false),
      async () => undefined,
    );
    assert.ok(text.includes("Нет доступа"));
  });

  it("/groups в группе (не DM) → отказ", async () => {
    const { setup } = makeSetup();
    const text = await runGroupsCommand(
      "",
      { chatId: "-100", userId: "42", isPrivate: false },
      deps(setup, true),
      async () => undefined,
    );
    assert.ok(text.includes("только в личных"));
  });

  it("/group <chatId> → карточка с кнопками", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Отдел", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    let cardText = "";
    let cardHasButtons = false;
    await runGroupsCommand(
      "-100",
      { chatId: "42", userId: "42", isPrivate: true },
      deps(setup, true),
      async (_chatId, text, extra) => {
        cardText = text;
        cardHasButtons = (extra?.inlineButtons?.length ?? 0) > 0;
      },
    );
    assert.ok(cardText.includes("Отдел"), "карточка отправлена с названием");
    assert.ok(cardHasButtons, "кнопки есть");
  });
});

describe("handleGroupCallback (S6)", () => {
  it("archive → markArchived (статус archived)", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    const handled = await handleGroupCallback("g:-100:archive", ctx(42), deps(setup, true));
    assert.equal(handled, true);
    assert.equal((await setup.get("-100"))?.status, "archived");
  });

  it("activate → reactivateFromArchived (статус active)", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    await setup.markArchived("-100");
    await handleGroupCallback("g:-100:activate", ctx(42), deps(setup, true));
    assert.equal((await setup.get("-100"))?.status, "active");
  });

  it("scenario → applyScenario secretary (preset listener)", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await handleGroupCallback("g:-100:scenario", ctx(42), deps(setup, true));
    const rec = await setup.get("-100");
    assert.equal(rec?.scenario, "secretary");
    assert.equal(rec?.presetId, "listener");
    assert.equal(rec?.status, "active");
  });

  it("посторонний → alert 'Нет доступа', статус не меняется", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    let alert = false;
    await handleGroupCallback(
      "g:-100:archive",
      ctx(999, { alert: (b) => (alert = b) }),
      deps(setup, false),
    );
    assert.equal(alert, true);
    assert.equal((await setup.get("-100"))?.status, "active", "не архивирована");
  });

  it("не g:-data → false", async () => {
    const { setup } = makeSetup();
    const handled = await handleGroupCallback("cs:-100:p:team", ctx(42), deps(setup, true));
    assert.equal(handled, false);
  });
});
