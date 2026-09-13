/**
 * Item 8.3 (H5): политика делегирования.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DELEGATION_POLICY,
  makeDelegationPolicy,
} from "../../src/runtime/delegation/policy.js";

describe("Delegation policy (Item 8.3)", () => {
  it("дефолт: отдельная роль delegation + ограниченный toolset", () => {
    assert.equal(DEFAULT_DELEGATION_POLICY.modelRole, "delegation");
    assert.deepEqual(DEFAULT_DELEGATION_POLICY.defaultToolsets, ["memory", "skill"]);
    assert.equal(DEFAULT_DELEGATION_POLICY.limits.maxDepth, 3);
  });

  it("makeDelegationPolicy: override лимитов/инструментов", () => {
    const policy = makeDelegationPolicy({
      defaultToolsets: ["sqlite"],
      limits: { maxDepth: 1, timeoutMs: 10_000, budgetTokens: 1_000, maxWorkers: 2 },
    });
    assert.deepEqual(policy.defaultToolsets, ["sqlite"]);
    assert.equal(policy.limits.maxDepth, 1);
    assert.equal(policy.modelRole, "delegation");
  });
});
