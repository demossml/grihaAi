/**
 * Phase 2 (Item 2.3, матрица B3) — FallbackChain: классификация ошибок и
 * политики перехода по пулу моделей.
 *
 * Правила (детерминированные, тестируемые):
 * - auth (401/403)      → стоп (смена модели не поможет);
 * - rate-limit (429)    → следующий кандидат;
 * - server (5xx)        → следующий кандидат;
 * - network/timeout     → следующий кандидат;
 * - context-overflow    → стоп: менять модель нельзя, нужна компакция;
 *   корреляция session/task сохраняется (цепочка возвращает попытку+конфиг,
 *   сообщения не трогает).
 * - unknown             → стоп (неизвестная ошибка не переключается).
 */
import type { ModelConfig } from "@griha/shared-types";

export type ErrorCategory =
  | "auth"
  | "rate-limit"
  | "server"
  | "network"
  | "timeout"
  | "context-overflow"
  | "unknown";

const CONTEXT_OVERFLOW_PATTERN =
  /context (length|window|overflow)|maximum context|too many tokens|token limit|prompt is too long/i;
const TIMEOUT_PATTERN = /timeout|timed out|ETIMEDOUT/i;
const NETWORK_PATTERN = /ECONN|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed/i;

/** Определяет категорию ошибки (приоритет: статус → контент → сеть). */
export function classifyError(err: unknown): ErrorCategory {
  const status = readStatus(err);
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (typeof status === "number" && status >= 500) return "server";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (CONTEXT_OVERFLOW_PATTERN.test(message)) return "context-overflow";
  if (TIMEOUT_PATTERN.test(message)) return "timeout";
  if (NETWORK_PATTERN.test(message)) return "network";
  return "unknown";
}

function readStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const raw = e?.status ?? e?.statusCode ?? e?.response?.status;
  return typeof raw === "number" ? raw : undefined;
}

/** Политика перехода: для какой категории можно переключиться на следующего. */
export const FALLBACK_ALLOWED: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  "rate-limit",
  "server",
  "network",
  "timeout",
]);

/**
 * Цепочка кандидатов (пул моделей). Каждый кандидат используется не более
 * одного раза (нет циклов). Возвращает индексы, не выполняет вызовы.
 */
export class FallbackChain {
  constructor(private readonly candidates: ModelConfig[]) {}

  get size(): number {
    return this.candidates.length;
  }

  /** Конфиг кандидата по индексу попытки. */
  pick(attemptIndex: number): ModelConfig | undefined {
    return this.candidates[attemptIndex];
  }

  /**
   * Следующий индекс после неудачной попытки, либо null = цепочка закончена.
   */
  nextAfter(attemptIndex: number, category: ErrorCategory): number | null {
    if (attemptIndex < 0 || attemptIndex >= this.candidates.length) return null;
    if (!FALLBACK_ALLOWED.has(category)) return null;
    const next = attemptIndex + 1;
    return next < this.candidates.length ? next : null;
  }
}
