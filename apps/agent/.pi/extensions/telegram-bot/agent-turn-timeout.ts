/**
 * C3/C4: wall-clock timeout для agent turn + обрезка «простыней».
 * Timeout НЕ отменяет уже успешный sendDocument — он отсекает ожидание
 * ответа агента на уровне race; фоновый LLM может доработать впустую (v1 ok).
 */

export class TurnTimeoutError extends Error {
  constructor(ms: number) {
    super(`Agent turn timed out after ${ms}ms`);
    this.name = "TurnTimeoutError";
  }
}

/** C3: default 90s; тяжёлые ветки (media+OCR / report PDF) — отдельный лимит. */
export const TURN_MS = Number(process.env.GRIHA_AGENT_TURN_MS ?? 90_000);
export const TURN_HEAVY_MS = Number(process.env.GRIHA_AGENT_TURN_HEAVY_MS ?? 180_000);

export async function withTurnTimeout<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new TurnTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([work(ac.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** C6: только исходящий текст агента; caption/пути файлов не трогаем. */
export function clipTelegramText(s: string, max = 4000): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "\n…(сокращено)";
}

export const TURN_TIMEOUT_MESSAGE =
  "Слишком долго обрабатываю запрос. Упростите вопрос или повторите позже.";
export const TURN_ERROR_MESSAGE = "Не удалось обработать запрос.";
export const EMPTY_REPLY_MESSAGE = "Пустой ответ. Переформулируйте вопрос.";
