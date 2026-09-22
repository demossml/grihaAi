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
 * Вернуть копию ModelConfig (без мутации). ModelConfig не имеет полей
 * temperature/maxTokens, поэтому здесь — только shallow copy; реальные
 * параметры генерации берутся из budgetToRuntimeParams.
 */
export function applyGenerationBudgetToModelConfig(
  config: ModelConfig,
  _budget: GenerationBudget,
  _opts?: { maxTokens?: number },
): ModelConfig {
  return { ...config };
}
