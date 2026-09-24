/**
 * P0 — scrub окружения для sandbox-процессов.
 *
 * Код, исполняемый в sandbox (execute_code / cron script-jobs), НЕ должен
 * наследовать host-секреты (TELEGRAM_BOT_TOKEN, apiKey, proxy-пароли, ...).
 * Пропускаем только безопасный allowlist runtime-переменных; всё остальное
 * (в т.ч. любые *_TOKEN / *_KEY / *_SECRET / *_PASSWORD) отбрасывается.
 */

const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SHELL",
  "USER",
  "NODE_ENV",
  "TZ",
]);

/**
 * Возвращает безопасное подмножество окружения (только allowlist).
 * Явные overrides накладываются поверх в вызывающем коде (`...scrubEnv(), ...overrides`).
 */
export function scrubEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Имена переменных, которые гарантированно вычищаются (для тестов/доков). */
export function isSensitiveEnvKey(key: string): boolean {
  return /(token|key|secret|password|passwd|credential|api[_-]?key|private)/i.test(key);
}
