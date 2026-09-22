import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelConfig } from "@griha/shared-types";
import {
  applyGenerationBudgetToModelConfig,
  budgetToRuntimeParams,
} from "../../../src/runtime/generation/apply-to-config.js";
import { resolveGenerationBudget } from "../../../src/runtime/generation/policy.js";

test("не мутирует исходный config object (shallow copy)", () => {
  const config: ModelConfig = { provider: "deepseek", model: "deepseek-v4-pro" };
  const budget = resolveGenerationBudget({ complexity: "medium" });
  const out = applyGenerationBudgetToModelConfig(config, budget);
  assert.notEqual(out, config, "должен быть новый объект");
  assert.equal(out.provider, "deepseek");
  assert.equal(out.model, "deepseek-v4-pro");
  assert.equal(config.provider, "deepseek", "исходный не изменён");
});

test("budgetToRuntimeParams несёт temperature/maxTokens/policyVersion", () => {
  const budget = resolveGenerationBudget({ complexity: "medium" });
  const params = budgetToRuntimeParams(budget);
  assert.equal(params.temperature, budget.temperature);
  assert.equal(params.maxTokens, budget.initialMaxTokens);
  assert.equal(params.policyVersion, "gp-1.0.0");
});
