import { emit } from "@griha/observability";
import type {
  ExtensionDecision,
  ExtensionState,
  GenerationBudget,
} from "./types.js";
import { tryExtendBudget } from "./allocator.js";

/**
 * Phase Obs v2 — обёртка tryExtendBudget с observability-событиями.
 * Ядро (tryExtendBudget) остаётся чистым; emit — только здесь, fail-safe.
 *
 * EXTEND_RUNTIME_WIRE: в prod multi-pass extend ещё не вызывается — хелпер
 * готов для Phase 3 (calibration auto-apply), но сейчас НЕ вызывается из runtime.
 */
export function tryExtendBudgetWithObs(
  budget: GenerationBudget,
  state: ExtensionState,
  meta?: { correlationId?: string; chatId?: string },
): ExtensionDecision {
  const d = tryExtendBudget(budget, state);
  if (d.ok) {
    emit({
      level: "info",
      component: "runtime.generation",
      event: "generation.extend",
      correlationId: meta?.correlationId,
      chatId: meta?.chatId,
      ok: true,
      data: {
        fromMaxTokens: state.currentMaxTokens,
        toMaxTokens: d.nextMaxTokens,
        extensionsUsed: d.extensionsUsed,
        maxExtensions: budget.maxExtensions,
      },
    });
  } else {
    emit({
      level: "info",
      component: "runtime.generation",
      event: "generation.extend_denied",
      correlationId: meta?.correlationId,
      chatId: meta?.chatId,
      data: {
        reason: d.reason,
        currentMaxTokens: state.currentMaxTokens,
        hardMaxTokens: budget.hardMaxTokens,
      },
    });
  }
  return d;
}
