/**
 * Phase 9 — Programmatic execution публичный API (чистые функции).
 * Исполнение остаётся в существующем sandbox-слое, wiring за флагом.
 */
export {
  DEFAULT_EXECUTE_CODE_POLICY,
  compactExecutionResult,
  planSatisfied,
  shouldUseExecuteCode,
  type CodeExecutionPlan,
  type ExecuteCodeDecision,
  type ExecuteCodePolicy,
  type ExecutionOutput,
} from "./plan.js";
export {
  classifyCodeRisk,
  sandboxDecision,
  sandboxForRisk,
  type CodeRiskLevel,
  type CodeRiskReport,
  type SandboxKind,
} from "./safety.js";
export {
  DEFAULT_EXECUTION_POLICY,
  ExecutionPolicyError,
  preflight,
  type CodeExecutor,
  type ExecuteCodeRequest,
  type ExecuteCodeResult,
  type ExecutionErrorKind,
  type ExecutionPolicy,
} from "./execute.js";
