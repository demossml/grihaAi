/**
 * Phase 10 (Item 10.3, матрица J4) — no-agent (script) jobs.
 *
 * Griha: automation без LLM — script job. Валидация и компактный отчёт;
 * фактическое исполнение — существующий sandbox-слой, wiring за флагом.
 */

export interface ScriptJobSpec {
  command: string;
  args?: string[];
  timeoutMs: number;
  maxOutputChars: number;
}

export const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT_CHARS = 10_000;

export interface ScriptValidationResult {
  valid: boolean;
  errors: string[];
}

/** Валидация spec script-job (команда обязательна, timeout > 0). */
export function validateScriptJob(spec: ScriptJobSpec): ScriptValidationResult {
  const errors: string[] = [];
  if (!spec.command || spec.command.trim().length === 0) {
    errors.push("command must not be empty");
  }
  if (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0) {
    errors.push("timeoutMs must be > 0");
  }
  if (!Number.isFinite(spec.maxOutputChars) || spec.maxOutputChars <= 0) {
    errors.push("maxOutputChars must be > 0");
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [] };
}

export interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Компактный отчёт выполнения script-job (no-agent: результат без LLM). */
export function scriptResultReport(result: ScriptRunResult, maxChars = 1000): string {
  const parts = [`exitCode: ${result.exitCode}`, `durationMs: ${result.durationMs}`];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  const body = parts.join("\n");
  return body.length > maxChars ? body.slice(0, Math.max(0, maxChars - 1)) + "…" : body;
}
