/**
 * Phase 4 (Item 4.3, матрица D2 + §9) — reciprocal rank fusion (RRF).
 *
 * §9 master spec: поиск сессий = FTS5 + vector + RRF. Сейчас `searchSessions`
 * FTS5-only (факты уже RRF в MemoryService). Этот модуль — чистый generic-RRF,
 * переиспользуемый для сессий при подключении векторного ранжирования.
 */

export interface RankedItem {
  id: string;
  /** Позиция в списке (0-based). Больше — слабее. */
  rank: number;
}

export const DEFAULT_RRF_K = 60;

/** RRF-скор отдельного элемента: 1 / (k + rank). */
export function rrfScore(rank: number, k: number = DEFAULT_RRF_K): number {
  return 1 / (k + Math.max(0, rank));
}

/**
 * Слияние нескольких ранжированных списков по RRF: сумма 1/(k+rank) по всем
 * спискам, где id присутствует. Результат отсортирован по убыванию скоров.
 */
export function rrfMerge(
  lists: readonly RankedItem[][],
  k: number = DEFAULT_RRF_K,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore(item.rank, k));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/** Преобразование отсортированного массива id в RankedItem (0-based ранги). */
export function rankedById(ids: readonly string[]): RankedItem[] {
  return ids.map((id, rank) => ({ id, rank }));
}
