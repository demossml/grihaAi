/**
 * Canonical skill metadata (agentskills.io layout).
 * Canonical home for the skills domain is @griha/skills — do not duplicate.
 */
export interface SkillMeta {
  name: string;
  description: string;
  /** Absolute path to the SKILL.md (or .md) file. */
  path: string;
  version?: string;
  tags?: string[];
  autoCreated?: boolean;
}
