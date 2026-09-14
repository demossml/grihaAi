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
