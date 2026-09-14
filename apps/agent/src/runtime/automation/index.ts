/**
 * Phase 10 — Automation публичный API (контракты + чистые функции).
 * Wiring к существующему CronService — за флагом `GRIHA_AGENT_RUNTIME`.
 */
export {
  InMemoryAutomationEngine,
  type AutomationEngine,
  type AutomationJob,
  type AutomationJobKind,
  type AutomationJobStatus,
  type AutomationRunners,
} from "./engine.js";
export {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_SCRIPT_TIMEOUT_MS,
  scriptResultReport,
  validateScriptJob,
  type ScriptJobSpec,
  type ScriptRunResult,
  type ScriptValidationResult,
} from "./script.js";
