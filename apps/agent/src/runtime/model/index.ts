/**
 * Phase 2 — Model Runtime публичный API (типы + чистые функции).
 * Ничего не подключено к production-путям.
 */
export {
  DEFAULT_MODEL_POLICIES,
  MODEL_RUNTIME_ROLES,
  modelPolicyFor,
  type ModelPolicy,
  type ModelRuntimeRole,
  type TaskProfile,
} from "./types.js";
export { resolveModelConfig, selectModelRole } from "./select.js";
export {
  FALLBACK_ALLOWED,
  FallbackChain,
  classifyError,
  type ErrorCategory,
} from "./fallback-chain.js";
export {
  DEFAULT_CONTEXT_WINDOW,
  MODEL_CONTEXT_WINDOW_CATALOG,
  PROVIDER_DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
} from "./context-window.js";
