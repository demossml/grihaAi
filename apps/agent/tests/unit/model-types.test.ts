/**
 * Item 2.1 (B1): роли, TaskProfile, ModelPolicy — поведение фабрик.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_POLICIES,
  MODEL_RUNTIME_ROLES,
  modelPolicyFor,
} from "../../src/runtime/model/types.js";

describe("Model runtime types (Item 2.1)", () => {
  it("все роли имеют дефолтную политику (без хардкода в call-sites)", () => {
    for (const role of MODEL_RUNTIME_ROLES) {
      const policy = DEFAULT_MODEL_POLICIES[role];
      assert.equal(policy.role, role);
      assert.equal(typeof policy.allowFallback, "boolean");
      assert.ok(policy.maxAttempts >= 1);
    }
  });

  it("main и vision повторяют прод-семантику: main — fallback разрешён, vision — нет", () => {
    assert.equal(DEFAULT_MODEL_POLICIES.main.allowFallback, true);
    assert.equal(DEFAULT_MODEL_POLICIES.vision.allowFallback, false);
    assert.equal(DEFAULT_MODEL_POLICIES.vision.maxAttempts, 1);
  });

  it("modelPolicyFor: override мержится, роль не перезаписывается чужим значением", () => {
    const policy = modelPolicyFor("main", { temperature: 0.1, maxTokens: 4096 });
    assert.equal(policy.role, "main");
    assert.equal(policy.temperature, 0.1);
    assert.equal(policy.maxTokens, 4096);
    assert.equal(policy.maxAttempts, DEFAULT_MODEL_POLICIES.main.maxAttempts);
  });

  it("embedding: температура 0 и без fallback", () => {
    const policy = DEFAULT_MODEL_POLICIES.embedding;
    assert.equal(policy.temperature, 0);
    assert.equal(policy.allowFallback, false);
  });
});
