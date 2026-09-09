/**
 * Классификация ошибок отправки Telegram (Пакет A — send reliability).
 * Чистые функции без grammy — легко тестировать.
 *
 * Ключевой инвариант: при 429/flood уважается retry_after (секунды),
 * 403/401/400 НЕ ретраятся тем же payload (кроме HTML→plain на верхнем уровне),
 * unknown — без ретраев в этом патче (не усугубляем).
 */

export type TelegramErrorKind =
  | "retry_after" // 429 / flood — ждать retry_after
  | "retryable" // сеть, 5xx, timeout — backoff
  | "forbidden" // 403 — бот кикнут / нет прав — не ретраить send loop
  | "bad_request" // 400 — не ретраить тот же payload (кроме HTML→plain на верхнем уровне)
  | "unauthorized" // 401 — токен
  | "unknown";

export interface ParsedTelegramError {
  kind: TelegramErrorKind;
  /** Seconds to wait; set when kind === "retry_after" */
  retryAfterSec?: number;
  description?: string;
  statusCode?: number;
}

interface AnyErrorLike {
  error_code?: unknown;
  description?: unknown;
  parameters?: unknown;
  response?: unknown;
  code?: unknown;
  statusCode?: unknown;
  message?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Извлечь retry_after из параметров Telegram-ошибки. */
function extractRetryAfter(params: unknown): number | null {
  const rec = asRecord(params);
  return rec ? toNumber(rec["retry_after"]) : null;
}

/** Рекурсивно искать { error_code, description, parameters } в err/err.response. */
function findErrorLike(err: unknown, depth = 0): AnyErrorLike | null {
  if (depth > 2) return null;
  const rec = asRecord(err);
  if (!rec) return null;
  if (rec["error_code"] !== undefined || rec["parameters"] !== undefined) {
    return rec as AnyErrorLike;
  }
  return findErrorLike(rec["response"], depth + 1);
}

/** Описание из err.description / err.message (для логов). */
function extractDescription(err: unknown): string | undefined {
  const rec = asRecord(err);
  if (!rec) return undefined;
  const d = rec["description"];
  if (typeof d === "string" && d.trim() !== "") return d;
  const m = rec["message"];
  if (typeof m === "string" && m.trim() !== "") return m;
  return undefined;
}

/**
 * Разобрать unknown throw от grammy/Telegram в класс ошибки.
 * Поддерживаемые формы:
 * - { error_code: 429, parameters: { retry_after: 13 } }
 * - { response: { error_code, parameters } }
 * - description "…retry after N…" / "Too Many Requests"
 * - сетевые сообщения ECONNRESET/ETIMEDOUT/"fetch failed"
 */
export function parseTelegramError(err: unknown): ParsedTelegramError {
  const description = extractDescription(err) ?? extractDescription(asRecord(err)?.response);
  const errorLike = findErrorLike(err);
  const statusCode = toNumber(errorLike?.error_code ?? errorLike?.statusCode) ?? undefined;
  const params = errorLike?.parameters;
  const retryAfter = extractRetryAfter(params);

  // 429 / flood — ждать retry_after (или хотя бы 1с, если его не прислали).
  if (statusCode === 429 || retryAfter !== null) {
    return {
      kind: "retry_after",
      retryAfterSec: retryAfter ?? 1,
      description,
      statusCode,
    };
  }

  if (statusCode !== undefined) {
    if (statusCode === 403) return { kind: "forbidden", description, statusCode };
    if (statusCode === 400) return { kind: "bad_request", description, statusCode };
    if (statusCode === 401) return { kind: "unauthorized", description, statusCode };
    // 5xx — временная ошибка Telegram/прокси → retryable.
    if (statusCode >= 500 && statusCode < 600) {
      return { kind: "retryable", description, statusCode };
    }
    // Прочие 4xx — unknown: без агрессивных ретраев.
    return { kind: "unknown", description, statusCode };
  }

  // description "Too Many Requests: retry after 13" без error_code.
  const retryMatch = /retry after (\d+)/i.exec(description ?? "");
  if (retryMatch) {
    return {
      kind: "retry_after",
      retryAfterSec: Math.max(1, Number(retryMatch[1])),
      description,
    };
  }
  if (/too many requests|flood/i.test(description ?? "")) {
    return { kind: "retry_after", retryAfterSec: 1, description };
  }

  // Сетевые ошибки (нет error_code): ECONNRESET/ETIMEDOUT/fetch failed и т.п.
  const text = `${description ?? ""} ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`;
  if (/econnreset|etimedout|econnrefused|enotfound|fetch failed|network|socket hang up|socket closed/i.test(text)) {
    return { kind: "retryable", description };
  }

  return { kind: "unknown", description };
}

/**
 * Пауза перед следующей попыткой. retry_after → ровно N секунд (+jitter);
 * retryable → экспонента base*2^(attempt-1); прочее → 0 (не ретраить).
 */
export function computeSendDelayMs(
  parsed: ParsedTelegramError,
  attempt: number, // 1-based, после неудачи
  opts?: { baseMs?: number; maxMs?: number; jitterRatio?: number },
): number {
  const base = opts?.baseMs ?? 1000;
  const maxMs = opts?.maxMs ?? 120_000;
  const jitterRatio = opts?.jitterRatio ?? 0.2;

  let ms: number;
  if (parsed.kind === "retry_after" && parsed.retryAfterSec != null) {
    ms = Math.max(1, parsed.retryAfterSec) * 1000;
  } else if (parsed.kind === "retryable") {
    ms = base * Math.pow(2, Math.max(0, attempt - 1));
  } else {
    return 0;
  }

  ms = Math.min(ms, maxMs);
  const jitter = ms * jitterRatio * Math.random();
  return Math.floor(ms + jitter);
}

export function shouldRetrySend(
  parsed: ParsedTelegramError,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) return false;
  return parsed.kind === "retry_after" || parsed.kind === "retryable";
}
