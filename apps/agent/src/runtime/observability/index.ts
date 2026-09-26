/**
 * Phase 16 — Observability публичный API (чистые функции).
 * Wiring в runtime/telemetry-конвейер — за флагом `GRIHA_AGENT_RUNTIME`.
 */
export {
  DEFAULT_MODEL_COST_RATES,
  ModelUsageAccumulator,
  estimateCost,
  type ModelCostRates,
  type SessionModelUsage,
  type TokenUsage,
} from "./usage.js";
export {
  TelemetryBuffer,
  generateCorrelationId,
  isValidCorrelationId,
  type RunTelemetry,
  type TelemetryEvent,
  type TelemetryEventKind,
} from "./telemetry.js";
export {
  renderTelemetryDashboard,
  recentErrors,
  type ObservabilitySnapshot,
  type RoleTotal,
} from "./dashboard.js";
export {
  TraceManager,
  getActiveTrace,
  getAgentVersion,
  registerTrace,
  unregisterTrace,
  type AgentTrace,
  type AgentTraceFinal,
  type AgentTraceStatus,
  type AgentTraceStep,
  type AgentTraceStepStatus,
  type AgentTraceStepType,
  type RetryTrace,
  type StepId,
  type TraceId,
  type TraceStartInput,
  type TraceStepInput,
} from "./trace.js";
export {
  computeTaskOutcome,
  type TaskOutcome,
} from "./task-outcome.js";
export {
  buildDiagnosticReport,
  computeMetrics,
  toEvaluationRecord,
  type AgentEvaluationRecord,
  type MetricsSummary,
} from "./metrics.js";
export {
  buildContextTrace,
  type ContextSource,
  type ContextSourceType,
  type ContextTrace,
} from "./context-trace.js";
export {
  buildRetrievalTrace,
  hashQueryText,
  type RetrievalQueryType,
  type RetrievalTrace,
} from "./retrieval-trace.js";
export {
  buildToolTrace,
  hashToolArgs,
  validateToolResult,
  type ToolResultValidation,
  type ToolTrace,
  type ToolTraceStatus,
} from "./tool-trace.js";
export {
  categoryForCode,
  codeFromRenderError,
  codeFromTurnCode,
  type AgentErrorCode,
  type FailureChainEntry,
  type PrimaryFailure,
} from "./error-taxonomy.js";
export {
  TraceStore,
  defaultTraceDbPath,
  getTraceStore,
  type TraceStoreOptions,
} from "./trace-store.js";
