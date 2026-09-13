/**
 * Phase 7 (Item 7.5, матрица G1) — триггер background review.
 *
 * Hermes: после хода — фоновый review более дешёвой моделью. Здесь —
 * детерминированное решение «когда запускать»; сам LLM-вызов (aux B5)
 * подключается за флагом.
 */

export interface BackgroundReviewPolicy {
  /** Каждый N-й turn. */
  everyNTurns: number;
  /** Минимум turns до первого review. */
  minTurns: number;
}

export const DEFAULT_BACKGROUND_REVIEW_POLICY: BackgroundReviewPolicy = {
  everyNTurns: 5,
  minTurns: 10,
};

export interface TurnInfo {
  turnIndex: number;
  /** Ход использовал инструменты. */
  usedTools: boolean;
  /** Ход завершился ошибкой. */
  hadError: boolean;
}

export interface BackgroundReviewDecision {
  review: boolean;
  reason: string;
}

/**
 * Когда запускать фоновый review:
 * 1) ошибка — всегда (немедленно);
 * 2) tool-вызов — всегда (результат стоит проверить);
 * 3) иначе — каждый everyNTurns turn, после minTurns.
 */
export function shouldBackgroundReview(
  turn: TurnInfo,
  policy: BackgroundReviewPolicy = DEFAULT_BACKGROUND_REVIEW_POLICY,
): BackgroundReviewDecision {
  if (turn.hadError) return { review: true, reason: "ход с ошибкой — немедленный review" };
  if (turn.usedTools) return { review: true, reason: "ход с tool-вызовами" };
  if (turn.turnIndex >= policy.minTurns && turn.turnIndex % policy.everyNTurns === 0) {
    return { review: true, reason: `плановый review (turn ${turn.turnIndex})` };
  }
  return { review: false, reason: "не требуется" };
}

/** Результат фонового review (уроки для G2-маршрутизации). */
export interface BackgroundReviewResult {
  turnIndex: number;
  lessons: Array<{ content: string; kind: "factual" | "procedural" | "preference" | "unknown" }>;
  createdAt: string;
}
