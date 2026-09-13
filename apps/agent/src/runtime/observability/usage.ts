/**
 * Phase 16 (Item 16.1, матрица P3 + §32) — cost/token accounting.
 *
 * §32: на уровне runtime считать input/output/cached/reasoning tokens,
 * tool calls, model cost, total estimated cost. Нужно для Model Router.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  toolCalls: number;
}

export interface SessionModelUsage extends TokenUsage {
  sessionId: string;
  modelRole: string;
  modelName?: string;
}

export interface ModelCostRates {
  /** USD за 1M токенов. */
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export const DEFAULT_MODEL_COST_RATES: ModelCostRates = {
  inputPerMillion: 0.28,
  outputPerMillion: 0.42,
  cachedPerMillion: 0.07,
};

/** Оценка стоимости по ставкам (USD). */
export function estimateCost(
  usage: TokenUsage,
  rates: ModelCostRates = DEFAULT_MODEL_COST_RATES,
): number {
  return (
    (usage.inputTokens * rates.inputPerMillion +
      usage.outputTokens * rates.outputPerMillion +
      usage.cachedTokens * rates.cachedPerMillion) /
    1_000_000
  );
}

/** Аккумулятор использования по сессиям/моделям (§32). */
export class ModelUsageAccumulator {
  private readonly records: SessionModelUsage[] = [];

  record(usage: SessionModelUsage): void {
    this.records.push({ ...usage });
  }

  /** Тоталы по роли модели (для Model Router). */
  totalsByRole(): Array<{ modelRole: string; usage: TokenUsage; cost: number; calls: number }> {
    const map = new Map<string, { usage: TokenUsage; calls: number }>();
    for (const r of this.records) {
      const entry = map.get(r.modelRole) ?? {
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, toolCalls: 0 },
        calls: 0,
      };
      entry.usage.inputTokens += r.inputTokens;
      entry.usage.outputTokens += r.outputTokens;
      entry.usage.cachedTokens += r.cachedTokens;
      entry.usage.reasoningTokens += r.reasoningTokens;
      entry.usage.toolCalls += r.toolCalls;
      entry.calls += 1;
      map.set(r.modelRole, entry);
    }
    return [...map.entries()].map(([modelRole, entry]) => ({
      modelRole,
      usage: entry.usage,
      cost: estimateCost(entry.usage),
      calls: entry.calls,
    }));
  }

  list(sessionId?: string): SessionModelUsage[] {
    const filtered = sessionId
      ? this.records.filter((r) => r.sessionId === sessionId)
      : this.records;
    return filtered.map((r) => ({ ...r }));
  }
}
