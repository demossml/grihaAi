/**
 * Phase 9 (Item 9.3, матрица I1) — контракт execute_code.
 *
 * Контракт вызова одного скрипта вместо N tool calls. Реализация исполнения
 * — существующие sandbox-классы (`src/sandbox`), подключаются за флагом
 * `GRIHA_AGENT_RUNTIME`.
 */
import { classifyCodeRisk, sandboxDecision, type SandboxKind } from "./safety.js";

export interface ExecuteCodeRequest {
  language: "typescript" | "javascript" | "python";
  code: string;
  /** Ожидаемый результат (опционально, для planSatisfied). */
  expectedResult?: string;
}

export interface ExecuteCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  sandbox: SandboxKind;
}

export interface ExecutionPolicy {
  sandbox?: SandboxKind;
  timeoutMs: number;
  maxOutputChars: number;
}

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  timeoutMs: 30_000,
  maxOutputChars: 100_000,
};

export type ExecutionErrorKind = "timeout" | "output-limit" | "sandbox-missing";

export class ExecutionPolicyError extends Error {
  constructor(readonly kind: ExecutionErrorKind, message: string) {
    super(message);
  }
}

/** Пре-флайт проверка запроса перед исполнением. */
export function preflight(
  request: ExecuteCodeRequest,
  policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY,
): { allowed: boolean; sandbox: SandboxKind; reason: string } {
  const report = classifyCodeRisk(request.code);
  const decision = sandboxDecision(report);
  if (policy.sandbox && policy.sandbox !== decision.sandbox && decision.mandatory) {
    return {
      allowed: false,
      sandbox: decision.sandbox,
      reason: `требуется ${decision.sandbox}, запрошен ${policy.sandbox} — sandbox обязателен для опасного кода`,
    };
  }
  return {
    allowed: true,
    sandbox: policy.sandbox ?? decision.sandbox,
    reason: decision.reason,
  };
}

/** Контракт исполнителя (реализация — существующий sandbox-слой). */
export interface CodeExecutor {
  execute(request: ExecuteCodeRequest, policy: ExecutionPolicy): Promise<ExecuteCodeResult>;
}
