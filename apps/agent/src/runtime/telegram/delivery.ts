/**
 * Phase 13 (Item 13.1, матрица M4) — контракт доставки Cron → Telegram.
 *
 * P02-семантика (архив e611cca), БЕЗ изменения telegram-bot слоя:
 * - execution ≠ delivery: результат доставки не влияет на status задачи;
 * - временные ошибки → retry, permanent → без повторов.
 * Реальный транспорт подключается за флагом `HERMES_AGENT_RUNTIME`.
 */

/** Парно J5-схеме (cron_jobs.chat_id/thread_id). */
export interface DeliveryTarget {
  chatId: string;
  threadId?: string;
}

export type DeliveryStatus = "ok" | "failed" | "permanent_failure" | "skipped";

export type DeliveryErrorKind = "temporary" | "permanent" | "unknown";

export interface DeliveryResult {
  status: DeliveryStatus;
  error?: string;
  attempts: number;
}

export interface DeliveryPolicy {
  /** Дополнительные ретраи при временной ошибке (P02: 2). */
  maxRetries: number;
  /** Пауза между ретраями, ms. */
  retryDelayMs: number;
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  maxRetries: 2,
  retryDelayMs: 2_000,
};

/** Транспорт доставки (реализация — за флагом; telegram-bot не меняется). */
export interface DeliveryTransport {
  send(target: DeliveryTarget, text: string): Promise<void>;
}

/** Классификация ошибки доставки: что ретраить, а что нет. */
export function classifyDeliveryError(err: unknown): DeliveryErrorKind {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (status === 429) return "temporary";
  if (status === 400 || status === 403) return "permanent";
  if (typeof status === "number" && status >= 500) return "temporary";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/timeout|ETIMEDOUT|ECONN|network/i.test(message)) return "temporary";
  if (/chat not found|bot was blocked|user not found|forbidden/i.test(message)) return "permanent";
  return "unknown";
}

/** Решение о повторе: temporary → ещё попытка, permanent/unknown → стоп. */
export function shouldRetry(
  kind: DeliveryErrorKind,
  attempts: number,
  policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY,
): { retry: boolean; reason: string } {
  if (kind !== "temporary") {
    return { retry: false, reason: `ошибка ${kind} — ретраи не применяются` };
  }
  if (attempts >= policy.maxRetries + 1) {
    return { retry: false, reason: `исчерпаны ${policy.maxRetries} дополнительных ретраев` };
  }
  return { retry: true, reason: `временная ошибка, ретрай ${attempts}/${policy.maxRetries}` };
}

/**
 * Приведение ошибки доставки к статусу. execution≠delivery: статус доставки
 * пишется в cron_runs.delivery_status и НЕ меняет status задачи.
 */
export function deliveryStatusFromError(kind: DeliveryErrorKind): DeliveryStatus {
  return kind === "permanent" ? "permanent_failure" : "failed";
}
