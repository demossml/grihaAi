/**
 * Phase 1 — применение бюджета к конфигу модели.
 * ModelConfig (shared-types) НЕ имеет temperature/maxTokens — параметры
 * генерации доступны через budgetToRuntimeParams (используются под флагом).
 */
import type { ModelConfig } from "@griha/shared-types";
import type { GenerationBudget } from "./types.js";

/** Параметры генерации, которые ModelConfig не несёт. */
export interface RuntimeGenerationParams {
  temperature: number;
  maxTokens: number;
  policyVersion: string;
}

export function budgetToRuntimeParams(
  budget: GenerationBudget,
  opts?: { maxTokens?: number },
): RuntimeGenerationParams {
  return {
    temperature: budget.temperature,
    maxTokens: opts?.maxTokens ?? budget.initialMaxTokens,
    policyVersion: budget.policyVersion,
  };
}

/**
 * @deprecated Реальное применение бюджета — `pool-apply-budget.applyBudgetToModel`
 * (Phase 2.3, pi `Model`). ModelConfig не несёт temperature/maxTokens, поэтому
 * здесь — только passthrough-copy; параметры генерации — из `budgetToRuntimeParams`.
 */
export function applyGenerationBudgetToModelConfig(
  config: ModelConfig,
  _budget: GenerationBudget,
  _opts?: { maxTokens?: number },
): ModelConfig {
  return { ...config };
}
