/**
 * Item 8.1 (H4): лимиты делегирования + recursion protection.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DelegationGuard } from "../../src/runtime/delegation/limits.js";

const state = (over: Partial<import("../../src/runtime/delegation/limits.js").GuardState> = {}) => ({
  currentDepth: 0,
  elapsedMs: 0,
  usedTokens: 0,
  workerCount: 0,
  ...over,
});

describe("DelegationGuard (Item 8.1)", () => {
  it("в пределах лимитов → allowed", () => {
    const guard = new DelegationGuard();
    assert.equal(guard.canDelegate(state()).allowed, true);
  });

  it("recursion depth protection: maxDepth превышен → отказ (§17)", () => {
    const guard = new DelegationGuard({ maxDepth: 3, timeoutMs: 120_000, budgetTokens: 32_000, maxWorkers: 4 });
    const d = guard.canDelegate(state({ currentDepth: 3 }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /recursion protection/);
    assert.equal(guard.canDelegate(state({ currentDepth: 2 })).allowed, true);
  });

  it("timeout / budget / workers — каждый блокирует", () => {
    const guard = new DelegationGuard();
    assert.equal(guard.canDelegate(state({ elapsedMs: 120_000 })).allowed, false);
    assert.equal(guard.canDelegate(state({ usedTokens: 32_000 })).allowed, false);
    assert.equal(guard.canDelegate(state({ workerCount: 4 })).allowed, false);
  });

  it("remainingTimeout/remainingBudget не уходят в минус", () => {
    const guard = new DelegationGuard();
    assert.equal(guard.remainingTimeout(state({ elapsedMs: 130_000 })), 0);
    assert.equal(guard.remainingBudget(state({ usedTokens: 40_000 })), 0);
    assert.equal(guard.remainingTimeout(state({ elapsedMs: 20_000 })), 100_000);
  });

  it("кастомные лимиты уважаются", () => {
    const guard = new DelegationGuard({ maxDepth: 1, timeoutMs: 10, budgetTokens: 5, maxWorkers: 1 });
    assert.equal(guard.canDelegate(state({ currentDepth: 1 })).allowed, false);
    assert.equal(guard.canDelegate(state({ elapsedMs: 10 })).allowed, false);
    assert.equal(guard.canDelegate(state({ usedTokens: 5 })).allowed, false);
    assert.equal(guard.canDelegate(state({ workerCount: 1 })).allowed, false);
  });
});
