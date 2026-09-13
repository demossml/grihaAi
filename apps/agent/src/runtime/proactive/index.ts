/**
 * Phase 14 — Proactive публичный API (чистые функции).
 * Ничего не подключено к production-путям.
 */
export {
  DEFAULT_PROACTIVE_POLICY,
  decideProactive,
  evaluateRelevance,
  type ProactiveDecision,
  type ProactiveEvent,
  type ProactiveEventKind,
  type ProactivePolicy,
} from "./decision.js";
export {
  DEFAULT_NUDGE_POLICY,
  scheduleNudge,
  type NudgeDecision,
  type NudgePolicy,
} from "./nudge.js";
