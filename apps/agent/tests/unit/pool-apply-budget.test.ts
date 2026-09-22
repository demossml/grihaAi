import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBudgetToModel } from "../../.pi/extensions/telegram-bot/pool-apply-budget.js";
import { resolveGenerationBudget } from "../../src/runtime/generation/policy.js";

test("applyBudgetToModel sets maxTokens === initialMaxTokens", () => {
  const budget = resolveGenerationBudget({ complexity: "medium" }); // initial 1024, temp 0.5
  const model: {
    id: string;
    provider: string;
    maxTokens: number;
    samplingParams: Record<string, unknown>;
  } = {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    maxTokens: 16384,
    samplingParams: { top_p: 0.9 },
  };
  const out = applyBudgetToModel(model, budget);
  assert.equal(out.maxTokens, 1024);
  assert.equal(out.samplingParams?.temperature, 0.5);
  assert.equal(out.samplingParams?.top_p, 0.9); // preserved
  assert.equal(out.id, "deepseek-v4-pro"); // preserved
  assert.equal(model.maxTokens, 16384); // исходник не мутирован
});

test("applyBudgetToModel adds temperature to empty samplingParams", () => {
  const budget = resolveGenerationBudget({ complexity: "simple" }); // temp 0.3
  const model: { id: string; maxTokens: number; samplingParams?: Record<string, unknown> } = {
    id: "m",
    maxTokens: 2048,
  };
  const out = applyBudgetToModel(model, budget);
  assert.equal(out.samplingParams?.temperature, 0.3);
});

test("applyBudgetToModel for each complexity respects initialMaxTokens", () => {
  for (const complexity of ["trivial", "simple", "medium", "complex"] as const) {
    const budget = resolveGenerationBudget({ complexity });
    const model: { id: string; maxTokens: number; samplingParams?: Record<string, unknown> } = {
      id: "m",
      maxTokens: 99999,
    };
    const out = applyBudgetToModel(model, budget);
    assert.equal(out.maxTokens, budget.initialMaxTokens);
    assert.ok(out.maxTokens > 0);
  }
});
