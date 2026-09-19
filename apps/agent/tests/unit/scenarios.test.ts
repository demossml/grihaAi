import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { PRESETS } from "../../.pi/extensions/chat-setup/RulePresets.js";
import { getScenario, listScenarios } from "../../.pi/extensions/scenarios/registry.js";
import type { ManagedRuleInput } from "../../.pi/extensions/user-rules/UserRulesService.js";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

function makeSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
  tmpDirs.push(dir);
  const replaced: Array<{ chatId: string; rules: ManagedRuleInput[]; meta: { source: string; actorId: string } }> = [];
  const rules = {
    replaced,
    replaceChatManagedRules(chatId: string, r: ManagedRuleInput[], meta: { source: string; actorId: string }) {
      replaced.push({ chatId, rules: r, meta });
    },
  };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup, replaced };
}

describe("scenario registry", () => {
  it("getScenario('secretary').defaultPresetId === 'listener'", () => {
    assert.equal(getScenario("secretary")?.defaultPresetId, "listener");
  });

  it("listScenarios содержит secretary", () => {
    assert.ok(listScenarios().some((s) => s.id === "secretary"));
  });

  it("getScenario неизвестного id → undefined", () => {
    assert.equal(getScenario("nope"), undefined);
  });
});

describe("applyScenario", () => {
  it("применяет listener + record.scenario=secretary, статус active", async () => {
    const { setup, replaced } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.applyScenario("-100", "secretary", { actorId: "1" });

    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].meta.source, "preset:listener");

    const rec = await setup.get("-100");
    assert.equal(rec?.scenario, "secretary");
    assert.equal(rec?.presetId, "listener");
    assert.equal(rec?.status, "active");
    assert.ok(rec?.activatedAt, "activatedAt проставлен");
  });

  it("НЕ меняет определение RulePresets.secretary", async () => {
    const { setup } = makeSetup();
    const before = JSON.stringify(PRESETS.secretary.rules);
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.applyScenario("-100", "secretary", { actorId: "1" });
    assert.equal(JSON.stringify(PRESETS.secretary.rules), before, "preset secretary не тронут");
    // Сценарий применяет listener (listen_only), а не secretary (require_mention).
    const rec = await setup.get("-100");
    assert.equal(rec?.presetId, "listener");
  });

  it("record без scenario работает (applyPreset как раньше)", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.applyPreset("-100", "team", { actorId: "1" });
    const rec = await setup.get("-100");
    assert.equal(rec?.scenario, undefined, "без сценария поле отсутствует");
    assert.equal(rec?.presetId, "team");
    assert.equal(rec?.status, "active");
  });

  it("applyScenario неизвестного id → бросает", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await assert.rejects(() => setup.applyScenario("-100", "nope", { actorId: "1" }));
  });
});
