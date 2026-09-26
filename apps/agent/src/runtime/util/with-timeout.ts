/**
 * Обёртка таймаута для тяжёлых операций (report render / data fetch).
 *
 * Не заменяет глобальный watchdog хода (300s) — это tool-level предел, чтобы
 * зависший report падал раньше (render ~90s), а не через 300s.
 */

export class TimeoutError extends Error {
  readonly code = "TOOL_TIMEOUT" as const;
  constructor(
    readonly label: string,
    readonly ms: number,
  ) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  label: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await Promise.race([
      fn(ac.signal),
      new Promise<T>((_, reject) => {
        ac.signal.addEventListener("abort", () => {
          reject(new TimeoutError(label, ms));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Tool-level таймауты для report path (данные быстрее, рендер дольше). */
export const REPORT_TOOL_TIMEOUTS = {
  dataMs: 30_000,
  renderMs: 90_000,
} as const;
