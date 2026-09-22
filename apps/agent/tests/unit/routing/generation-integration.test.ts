import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGenerationBudget } from "../../../src/runtime/generation/policy.js";
import type { TaskComplexity } from "../../../src/runtime/generation/types.js";

test("resolveGenerationBudget works for each complexity", () => {
  for (const complexity of [
    "trivial",
    "simple",
    "medium",
    "complex",
  ] as TaskComplexity[]) {
    const budget = resolveGenerationBudget({ complexity });
    assert.equal(budget.complexity, complexity);
    assert.ok(budget.initialMaxTokens <= budget.softMaxTokens);
    assert.ok(budget.softMaxTokens <= budget.hardMaxTokens);
  }
});
