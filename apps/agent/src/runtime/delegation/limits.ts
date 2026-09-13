/**
 * Phase 8 (Item 8.1, матрица H4) — лимиты делегирования.
 *
 * §17 master spec: каждый subagent — timeout, budget; обязательна recursion
 * depth protection. Чистая логика с инъекцией часов.
 */

export interface DelegationLimits {
  /** Максимальная глубина рекурсии (subagent → subagent). */
  maxDepth: number;
  /** Таймаут одного worker, ms. */
  timeoutMs: number;
  /** Бюджет токенов на делегирование. */
  budgetTokens: number;
  /** Максимум параллельных workers. */
  maxWorkers: number;
}

export const DEFAULT_DELEGATION_LIMITS: DelegationLimits = {
  maxDepth: 3,
  timeoutMs: 120_000,
  budgetTokens: 32_000,
  maxWorkers: 4,
};

export interface GuardState {
  currentDepth: number;
  elapsedMs: number;
  usedTokens: number;
  workerCount: number;
}

export interface GuardDecision {
  allowed: boolean;
  reason: string;
}

export class DelegationGuard {
  constructor(private readonly limits: DelegationLimits = DEFAULT_DELEGATION_LIMITS) {}

  /** Проверка перед запуском нового worker на текущей глубине. */
  canDelegate(state: GuardState): GuardDecision {
    if (state.currentDepth >= this.limits.maxDepth) {
      return {
        allowed: false,
        reason: `depth ${state.currentDepth} >= maxDepth ${this.limits.maxDepth} — recursion protection`,
      };
    }
    if (state.elapsedMs >= this.limits.timeoutMs) {
      return { allowed: false, reason: `timeout exceeded: ${state.elapsedMs}ms` };
    }
    if (state.usedTokens >= this.limits.budgetTokens) {
      return { allowed: false, reason: `budget exceeded: ${state.usedTokens} tokens` };
    }
    if (state.workerCount >= this.limits.maxWorkers) {
      return { allowed: false, reason: `maxWorkers ${this.limits.maxWorkers} reached` };
    }
    return { allowed: true, reason: "ok" };
  }

  /** Остаток таймаута для worker'а (не уходит в минус). */
  remainingTimeout(state: GuardState): number {
    return Math.max(0, this.limits.timeoutMs - state.elapsedMs);
  }

  /** Остаток бюджета токенов. */
  remainingBudget(state: GuardState): number {
    return Math.max(0, this.limits.budgetTokens - state.usedTokens);
  }
}
