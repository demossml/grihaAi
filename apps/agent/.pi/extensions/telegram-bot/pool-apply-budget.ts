import type { GenerationBudget } from "../../../src/runtime/generation/index.js";

/**
 * Phase 2.3 — применить GenerationBudget к pi Model.
 *
 * Клонирует модель (без мутации) с:
 *   - maxTokens = budget.initialMaxTokens (реальный лимит output tokens);
 *   - samplingParams.temperature = budget.temperature (если провайдер принимает).
 *
 * pi использует `Model.maxTokens` как лимит output tokens в запросе
 * (см. `@earendil-works/pi-ai` `Model.maxTokens` + `adjustMaxTokensForThinking`).
 * `samplingParams` — per-model дефолтные sampling-параметры (temperature и т.п.).
 */
export function applyBudgetToModel<
  M extends { maxTokens: number; samplingParams?: Record<string, unknown> },
>(model: M, budget: GenerationBudget): M {
  return {
    ...model,
    maxTokens: budget.initialMaxTokens,
    samplingParams: {
      ...(model.samplingParams ?? {}),
      temperature: budget.temperature,
    },
  };
}
