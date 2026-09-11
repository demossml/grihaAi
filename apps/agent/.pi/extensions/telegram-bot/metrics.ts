/**
 * PROMPT 10 — простые in-process метрики Telegram layer.
 * Счётчики инкрементируются на горячих точках (updates/media/agent/ошибки).
 * Экспорт: getTelegramMetrics() → Record<string, number> (для логов/дашбордов).
 * Credentials/транскрипты/содержимое документов НЕ логируются.
 */

const counters = new Map<string, number>();

export function incMetric(name: string, n = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + n);
}

export function getTelegramMetrics(): Record<string, number> {
  return Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export const TELEGRAM_METRIC_NAMES = [
  "telegram_updates_total",
  "telegram_updates_failed",
  "telegram_media_total",
  "telegram_media_processed",
  "telegram_media_failed",
  "telegram_media_retried",
  "telegram_listener_archived",
  "telegram_agent_invocations",
  "telegram_agent_denied",
  "telegram_ocr_failed",
  "telegram_stt_failed",
] as const;
