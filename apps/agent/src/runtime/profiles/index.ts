/**
 * Phase 15 — Profiles публичный API (чистые функции).
 * Wiring в boot/config — за флагом `GRIHA_AGENT_RUNTIME`.
 */
export {
  DEFAULT_PROFILES,
  ProfileRegistry,
  createDefaultProfileRegistry,
  type AgentProfile,
  type AutomationPolicyRef,
  type MemoryPolicyRef,
} from "./profile.js";
export {
  validateProfile,
  validateProfiles,
  type ProfileValidationResult,
} from "./validation.js";
