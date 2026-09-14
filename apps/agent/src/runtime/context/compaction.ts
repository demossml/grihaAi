/**
 * Phase 3 (Item 3.2, матрица C2) — решение о компакции.
 *
 * Контракт §8 master spec: `shouldCompress()`. Dual system (Griha):
 * agent-порог 50% бюджета, gateway hygiene-порог 85%.
 * Чистая функция с инъекцией времени — детерминированно и тестируемо.
 */

export interface CompactionPolicy {
  /** Порог «agent»-компакции (доля бюджета). Griha: 0.5. */
  agentRatioThreshold: number;
  /** Порог «gateway»-гигиены (доля бюджета). Griha: 0.85. */
  gatewayRatioThreshold: number;
  /** Пауза между компакциями, ms. */
  cooldownMs: number;
  /** Минимум turns до первой компакции. */
  minTurns: number;
}

export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
  agentRatioThreshold: 0.5,
  gatewayRatioThreshold: 0.85,
  cooldownMs: 60_000,
  minTurns: 4,
};

export type CompactionLevel = "none" | "agent" | "gateway";

export interface CompactionDecision {
  level: CompactionLevel;
  reason: string;
  ratio: number;
}

export interface UsageState {
  usedTokens: number;
  budgetTokens: number;
  turnCount: number;
}

/**
 * Решение о компакции.
 * Порядок правил: cooldown → minTurns → gateway → agent.
 * `nowMs`/`lastCompactionAtMs` — для детерминированных тестов.
 */
export function shouldCompress(
  state: UsageState,
  nowMs: number,
  lastCompactionAtMs: number | undefined,
  policy: CompactionPolicy = DEFAULT_COMPACTION_POLICY,
): CompactionDecision {
  const ratio = state.budgetTokens > 0 ? state.usedTokens / state.budgetTokens : 0;
  const none = (reason: string): CompactionDecision => ({ level: "none", reason, ratio });
  if (
    typeof lastCompactionAtMs === "number" &&
    nowMs - lastCompactionAtMs < policy.cooldownMs
  ) {
    return none(`cooldown: ${nowMs - lastCompactionAtMs}ms < ${policy.cooldownMs}ms`);
  }
  if (state.turnCount < policy.minTurns) {
    return none(`minTurns: ${state.turnCount} < ${policy.minTurns}`);
  }
  if (ratio >= policy.gatewayRatioThreshold) {
    return { level: "gateway", reason: `ratio ${ratio.toFixed(3)} >= ${policy.gatewayRatioThreshold}`, ratio };
  }
  if (ratio >= policy.agentRatioThreshold) {
    return { level: "agent", reason: `ratio ${ratio.toFixed(3)} >= ${policy.agentRatioThreshold}`, ratio };
  }
  return none(`ratio ${ratio.toFixed(3)} ниже порога`);
}
