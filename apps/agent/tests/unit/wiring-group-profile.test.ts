/**
 * O1 (post-wiring, отдельный шаг) — групповой profile-override (§29).
 * Правило чата `agent_profile` → persona-секция профиля в rulesContext
 * за флагом; off/нет правила/неизвестный профиль → пусто (1:1).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserRule } from "@griha/shared-types";
import {
  buildGroupProfileSection,
  ruleProfileName,
} from "../../.pi/extensions/telegram-bot/group-profile.js";
import { prepareGroupTurn } from "../../.pi/extensions/telegram-bot/group-runtime.js";

const ON: NodeJS.ProcessEnv = { GRIHA_AGENT_RUNTIME: "1" };
const OFF: NodeJS.ProcessEnv = {};

function rule(partial: Partial<UserRule>): UserRule {
  return {
    id: "r1",
    scope: "chat",
    chatId: "1",
    text: "",
    kind: "soft",
    enabled: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  };
}

describe("Групповой profile-override (O1)", () => {
  it("flag off → секция пустая, даже с правилом agent_profile", () => {
    const rules = [rule({ key: "agent_profile", value: "accountant" })];
    assert.equal(buildGroupProfileSection(OFF, rules), "");
  });

  it("правило key=agent_profile → persona-секция профиля", () => {
    const rules = [rule({ key: "agent_profile", value: "accountant" })];
    const section = buildGroupProfileSection(ON, rules);
    assert.ok(section.includes("## Agent profile: Accountant"));
    assert.ok(section.includes("Model role:"));
  });

  it("текстовая форма 'agent_profile: developer' тоже работает", () => {
    const rules = [rule({ text: "agent_profile: developer" })];
    assert.ok(buildGroupProfileSection(ON, rules).includes("## Agent profile: Developer"));
  });

  it("отключённое правило игнорируется", () => {
    const rules = [
      rule({ key: "agent_profile", value: "accountant", enabled: false }),
    ];
    assert.equal(buildGroupProfileSection(ON, rules), "");
  });

  it("неизвестный профиль → пусто (не ломает контекст)", () => {
    const rules = [rule({ key: "agent_profile", value: "no-such-profile" })];
    assert.equal(buildGroupProfileSection(ON, rules), "");
  });

  it("ruleProfileName: первое активное правило выигрывает", () => {
    assert.equal(
      ruleProfileName([
        rule({ key: "agent_profile", value: "travel", enabled: false }),
        rule({ text: "agent_profile=secretary" }),
        rule({ key: "agent_profile", value: "researcher" }),
      ]),
      "secretary",
    );
  });

  it("prepareGroupTurn: profileSection добавляется в rulesContext", () => {
    const result = prepareGroupTurn(
      {
        chatId: "1",
        userId: "u",
        chatType: "group",
        isGroup: true,
        text: "привет",
      },
      {
        isGroupConfigured: () => true,
        getHardRules: () => [],
        getSoftRules: () => [],
        evaluate: () => ({ process: true, suppressReply: false, archive: false }),
        formatRules: () => "[GROUP_RULES]\n[/GROUP_RULES]",
        profileSection: () => "## Agent profile: Accountant\npersona",
      },
    );
    assert.ok(result.rulesContext.includes("[GROUP_RULES]"));
    assert.ok(result.rulesContext.includes("## Agent profile: Accountant"));
  });

  it("prepareGroupTurn без profileSection → rulesContext без секции (1:1)", () => {
    const result = prepareGroupTurn(
      {
        chatId: "1",
        userId: "u",
        chatType: "group",
        isGroup: true,
        text: "привет",
      },
      {
        isGroupConfigured: () => true,
        getHardRules: () => [],
        getSoftRules: () => [],
        evaluate: () => ({ process: true, suppressReply: false, archive: false }),
        formatRules: () => "[GROUP_RULES]\n[/GROUP_RULES]",
      },
    );
    assert.ok(result.rulesContext.includes("[GROUP_RULES]"));
    assert.ok(!result.rulesContext.includes("## Agent profile"));
  });
});
