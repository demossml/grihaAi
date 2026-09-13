/**
 * Phase 6 — Skill Engine публичный API (disclosure / diff / versioning).
 * Ничего не подключено к production-путям.
 */
export {
  discloseLevel0,
  discloseLevel1,
  discloseLevel2,
  discloseSkill,
  type DisclosureLevel,
  type SkillDescriptor,
} from "./disclosure.js";
export {
  applyDiff,
  diffChangeCount,
  diffLines,
  splitLines,
  type DiffOp,
  type DiffOpKind,
} from "./diff.js";
export {
  SkillVersionStore,
  type SkillEvaluation,
  type SkillVersion,
  type SkillVersionStoreOptions,
} from "./versioning.js";
