/**
 * Phase 9 (Item 9.2, матрица I1) — классификация риска кода.
 *
 * §20 master spec: sandbox обязателен для опасного execution.
 * Лучшая-усилия текстовая классификация — гейт перед выбором sandbox'а;
 * фактическая изоляция выполняется существующими LocalSandbox/RunscSandbox.
 */

export type CodeRiskLevel = "safe" | "dangerous";

export interface CodeRiskReport {
  level: CodeRiskLevel;
  reasons: string[];
}

const NETWORK_PATTERN = /\b(fetch|https?:\/\/|axios|net\.|socket|http\.(get|request)|xmlhttprequest)\b/i;
const FS_WRITE_PATTERN = /\b(writeFileSync|writeFile|appendFile|unlinkSync|rmSync|rmdirSync|mkdirSync|fs\.write|fs\.append|fs\.unlink|os\.remove|shutil\.rmtree)/i;
const PROCESS_PATTERN = /\b(child_process|execSync|spawn|exec\(|process\.(exit|kill)|os\.system|subprocess)\b/i;
const EVAL_PATTERN = /\b(eval|new Function|vm\.runIn|exec\(|compile\()\b/i;
const SHELL_PATTERN = /\b(bash|sh -c|zsh|powershell|cmd \/c)\b/i;
const ENV_PATTERN = /\b(process\.env|os\.environ|API_KEY|TOKEN|SECRET)\b/i;

/** Классификация риска по опасным паттернам. */
export function classifyCodeRisk(code: string): CodeRiskReport {
  const reasons: string[] = [];
  if (NETWORK_PATTERN.test(code)) reasons.push("network access");
  if (FS_WRITE_PATTERN.test(code)) reasons.push("filesystem write/delete");
  if (PROCESS_PATTERN.test(code)) reasons.push("process execution");
  if (EVAL_PATTERN.test(code)) reasons.push("dynamic code evaluation");
  if (SHELL_PATTERN.test(code)) reasons.push("shell command");
  if (ENV_PATTERN.test(code)) reasons.push("secrets/env access");
  return {
    level: reasons.length > 0 ? "dangerous" : "safe",
    reasons,
  };
}

export type SandboxKind = "local" | "runsc";

/** Опасный код → runsc (gVisor), иначе локальный sandbox. */
export function sandboxForRisk(report: CodeRiskReport): SandboxKind {
  return report.level === "dangerous" ? "runsc" : "local";
}

/** Решение с обоснованием (для approval-логирования). */
export function sandboxDecision(report: CodeRiskReport): {
  sandbox: SandboxKind;
  mandatory: boolean;
  reason: string;
} {
  const dangerous = report.level === "dangerous";
  return {
    sandbox: dangerous ? "runsc" : "local",
    mandatory: dangerous,
    reason: dangerous
      ? `опасный код (${report.reasons.join(", ")}) — sandbox обязателен`
      : "код безопасен — локальный sandbox",
  };
}
