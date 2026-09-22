/**
 * Phase 1 — BudgetAllocator: расширение бюджета в пределах hard/maxExtensions.
 */
import type { ExtensionDecision, ExtensionState, GenerationBudget } from "./types.js";

export function createExtensionState(budget: GenerationBudget): ExtensionState {
  return {
    extensionsUsed: 0,
    currentMaxTokens: budget.initialMaxTokens,
  };
}

/**
 * Можно ли расширить budget (evaluator сказал «нужно ещё»).
 * Не превышает hard. Не больше maxExtensions.
 */
export function tryExtendBudget(
  budget: GenerationBudget,
  state: ExtensionState,
): ExtensionDecision {
  if (state.extensionsUsed >= budget.maxExtensions) {
    return { ok: false, reason: "max_extensions" };
  }
  if (state.currentMaxTokens >= budget.hardMaxTokens) {
    return { ok: false, reason: "already_at_hard" };
  }
  const next = Math.min(
    state.currentMaxTokens + budget.extensionStepTokens,
    budget.hardMaxTokens,
  );
  if (next <= state.currentMaxTokens) {
    return { ok: false, reason: "would_exceed_hard" };
  }
  return {
    ok: true,
    nextMaxTokens: next,
    extensionsUsed: state.extensionsUsed + 1,
  };
}

export function applyExtension(
  state: ExtensionState,
  decision: Extract<ExtensionDecision, { ok: true }>,
): ExtensionState {
  return {
    extensionsUsed: decision.extensionsUsed,
    currentMaxTokens: decision.nextMaxTokens,
  };
}
