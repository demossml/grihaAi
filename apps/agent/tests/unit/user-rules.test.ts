import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import {
  detectKind,
  isOnlyOwnerRule,
  shouldProcessMessage,
} from "../../.pi/extensions/user-rules/prefilter.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";
import type { UserRule } from "@griha/shared-types";

const DB_NAME = "user-rules-test.sqlite";

function freshService(): UserRulesService {
  cleanTestDb(DB_NAME);
  const svc = new UserRulesService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("user rules service", () => {
  it("adds, lists, gets, edits and deletes a rule", () => {
    const svc = freshService();
    const rule = svc.add({ scope: "global", text: "Отвечай вежливо" });
    assert.equal(rule.kind, "soft");
    assert.equal(rule.enabled, true);
    assert.equal(svc.list().length, 1);
    assert.equal(svc.get(rule.id)?.text, "Отвечай вежливо");

    const edited = svc.edit(rule.id, { text: "Будь лаконичен" });
    assert.equal(edited?.text, "Будь лаконичен");

    assert.equal(svc.delete(rule.id), true);
    assert.equal(svc.get(rule.id), null);
  });

  it("persists across reopen", () => {
    const path = getTestDbPath(DB_NAME);
    cleanTestDb(DB_NAME);
    const svc1 = new UserRulesService(path);
    svc1.init();
    svc1.add({ scope: "global", text: "Правило", kind: "soft" });
    svc1.close();

    const svc2 = new UserRulesService(path);
    svc2.init();
    assert.equal(svc2.list().length, 1);
    svc2.close();
  });

  it("scopes hard/soft rules by chat", () => {
    const svc = freshService();
    svc.add({ scope: "global", text: "глобальное soft", kind: "soft" });
    svc.add({ scope: "global", text: "отвечай только на мои сообщения", kind: "hard", ownerUserId: "111" });
    svc.add({ scope: "chat", chatId: "42", text: "чат soft", kind: "soft" });
    svc.add({ scope: "chat", chatId: "42", text: "только мои сообщения", kind: "hard", ownerUserId: "111" });

    assert.equal(svc.getHardRules("42").length, 2); // global hard + chat hard
    assert.equal(svc.getHardRules("7").length, 1); // global hard only
    assert.equal(svc.getSoftRules("42").length, 2); // global soft + chat soft
    assert.equal(svc.getSoftRules("7").length, 1);
  });

  it("requires chatId for chat scope", () => {
    const svc = freshService();
    assert.throws(() => svc.add({ scope: "chat", text: "x" }));
  });
});

describe("prefilter", () => {
  it("detectKind classifies hard vs soft", () => {
    assert.equal(detectKind("отвечай только на мои сообщения"), "hard");
    assert.equal(detectKind("игнорируй других"), "hard");
    assert.equal(detectKind("будь вежлив и лаконичен"), "soft");
  });

  it("isOnlyOwnerRule matches owner-restriction texts", () => {
    const rule = (text: string): UserRule => ({
      id: "1",
      scope: "chat",
      chatId: "42",
      ownerUserId: "111",
      text,
      kind: "hard",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    });
    assert.equal(isOnlyOwnerRule(rule("отвечай только на мои сообщения")), true);
    assert.equal(isOnlyOwnerRule(rule("будь вежлив")), false);
  });

  it("blocks non-owner when only-owner rule is present", () => {
    const rule: UserRule = {
      id: "1",
      scope: "chat",
      chatId: "42",
      ownerUserId: "111",
      text: "отвечай только на мои сообщения",
      kind: "hard",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    };
    assert.equal(
      shouldProcessMessage([rule], { chatId: "42", fromUserId: "111", text: "hi" }),
      true,
    );
    assert.equal(
      shouldProcessMessage([rule], { chatId: "42", fromUserId: "222", text: "hi" }),
      false,
    );
  });
});
