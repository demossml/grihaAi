/**
 * PROMPT 4 — структурированная техническая диагностика ошибок Telegram-пути.
 *
 * Одна строка JSON в console.error — существующий в проекте механизм логов
 * (новый logging framework не добавляется). Поля:
 *
 *   operation  — что делали (agent_prompt / reset / voice_transcribe / ...);
 *   stage      — lifecycle stage (prompt / watchdog / drain / ...);
 *   sessionId  — если доступен;
 *   chatId     — если доступен;
 *   userId     — если доступен;
 *   threadId   — если доступен;
 *   error      — type/message ошибки (без стека, без сырого объекта);
 *   detail     — краткая техническая пометка.
 *
 * НЕ логируются: пользовательский текст, токены, credentials, содержимое
 * файлов, секреты — сюда попадают только поля выше.
 *
 * Инвариант: logTelegramError НИКОГДА не бросает (try/catch на всём пути),
 * иначе диагностика сама роняла бы agent path.
 */

export interface TelegramErrorDiag {
  operation: string;
  stage?: string;
  sessionId?: string;
  chatId?: string | number;
  userId?: string | number;
  threadId?: string | number;
  error?: unknown;
  detail?: string;
}

/** Безопасное представление ошибки: `Name: message` (без стека/сырых объектов). */
export function formatTelegramError(err: unknown): string {
  try {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  } catch {
    return "[unserializable error]";
  }
}

/** Записать структурированную диагностику. Не бросает никогда. */
export function logTelegramError(diag: TelegramErrorDiag): void {
  try {
    const entry: Record<string, string | number> = { operation: diag.operation };
    if (diag.stage !== undefined) entry.stage = diag.stage;
    if (diag.sessionId !== undefined) entry.sessionId = diag.sessionId;
    if (diag.chatId !== undefined) entry.chatId = diag.chatId;
    if (diag.userId !== undefined) entry.userId = diag.userId;
    if (diag.threadId !== undefined) entry.threadId = diag.threadId;
    if (diag.error !== undefined) entry.error = formatTelegramError(diag.error);
    if (diag.detail !== undefined) entry.detail = diag.detail;
    // Все значения — примитивы: JSON.stringify не может упасть. Но guard
    // оставлен — logging не должен бросать ни при каких условиях.
    console.error(`[telegram-bot] diag ${JSON.stringify(entry)}`);
  } catch {
    /* никогда не бросаем из логирования */
  }
}

/**
 * P4: структурированная трасса жизненного цикла Telegram (успешный путь).
 * Одна JSON-строка в console.log — тот же механизм, что у PROMPT 7
 * outcome-трассы. НЕ логируются: текст сообщений, токены, secrets, OCR,
 * содержимое файлов — только идентификаторы/размеры/тайминги.
 */
export interface TelegramEvent {
  event: string;
  correlationId?: string;
  chatId?: string | number;
  threadId?: string | number;
  updateId?: number;
  userId?: string | number;
  sessionId?: string;
  durationMs?: number;
  status?: string;
  reason?: string;
  fileSize?: number;
  sha256?: string;
  mimeType?: string;
  artifactId?: string;
}

/** Записать структурированное событие lifecycle. Не бросает никогда. */
export function logTelegramEvent(event: TelegramEvent): void {
  try {
    const entry: Record<string, string | number> = { event: event.event };
    if (event.correlationId !== undefined) entry.correlationId = event.correlationId;
    if (event.chatId !== undefined) entry.chatId = event.chatId;
    if (event.threadId !== undefined) entry.threadId = event.threadId;
    if (event.updateId !== undefined) entry.updateId = event.updateId;
    if (event.userId !== undefined) entry.userId = event.userId;
    if (event.sessionId !== undefined) entry.sessionId = event.sessionId;
    if (event.durationMs !== undefined) entry.durationMs = event.durationMs;
    if (event.status !== undefined) entry.status = event.status;
    if (event.reason !== undefined) entry.reason = event.reason;
    if (event.fileSize !== undefined) entry.fileSize = event.fileSize;
    if (event.sha256 !== undefined) entry.sha256 = event.sha256;
    if (event.mimeType !== undefined) entry.mimeType = event.mimeType;
    if (event.artifactId !== undefined) entry.artifactId = event.artifactId;
    console.log(`[telegram-bot] event ${JSON.stringify(entry)}`);
  } catch {
    /* никогда не бросаем из логирования */
  }
}

/** P4: correlation id = tg.{chatId}.{updateId}; без update_id — fallback-последовательность. */
export function buildTelegramCorrelationId(
  chatId: string | number,
  updateId?: number,
  fallbackSeq?: number,
): string {
  if (updateId !== undefined) return `tg.${chatId}.${updateId}`;
  return `tg.${chatId}.${fallbackSeq ?? "x"}`;
}
