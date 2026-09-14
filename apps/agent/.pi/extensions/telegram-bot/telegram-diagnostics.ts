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
