/**
 * Item 16.1 (P3/§32): token/cost accounting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ModelUsageAccumulator,
  estimateCost,
} from "../../src/runtime/observability/usage.js";

describe("Cost accounting (Item 16.1)", () => {
  it("estimateCost: сумма по ставкам", () => {
    const cost = estimateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000, reasoningTokens: 0, toolCalls: 1 },
      { inputPerMillion: 0.3, outputPerMillion: 0.4, cachedPerMillion: 0.1 },
    );
    assert.equal(cost, 0.8);
  });

  it("estimateCost: дефолтные ставки", () => {
    const cost = estimateCost({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, toolCalls: 0 });
    assert.equal(cost, 0);
  });

  it("accumulator: totals по ролям (для Model Router)", () => {
    const acc = new ModelUsageAccumulator();
    acc.record({
      sessionId: "s1", modelRole: "main",
      inputTokens: 100, outputTokens: 50, cachedTokens: 0, reasoningTokens: 10, toolCalls: 2,
    });
    acc.record({
      sessionId: "s2", modelRole: "main",
      inputTokens: 200, outputTokens: 100, cachedTokens: 0, reasoningTokens: 0, toolCalls: 1,
    });
    acc.record({
      sessionId: "s1", modelRole: "vision",
      inputTokens: 50, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, toolCalls: 0,
    });
    const totals = acc.totalsByRole();
    assert.equal(totals.length, 2);
    const main = totals.find((t) => t.modelRole === "main")!;
    assert.equal(main.usage.inputTokens, 300);
    assert.equal(main.usage.toolCalls, 3);
    assert.equal(main.calls, 2);
    assert.ok(main.cost > 0);
  });

  it("list: фильтр по sessionId", () => {
    const acc = new ModelUsageAccumulator();
    acc.record({ sessionId: "a", modelRole: "main", inputTokens: 1, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, toolCalls: 0 });
    acc.record({ sessionId: "b", modelRole: "main", inputTokens: 1, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, toolCalls: 0 });
    assert.equal(acc.list().length, 2);
    assert.equal(acc.list("a").length, 1);
  });
});
