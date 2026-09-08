import type { SkillMeta } from "./types.js";

/** Format a list of skills for inclusion in a system prompt. */
export function formatSkillsForPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "No skills available.";
  return skills
    .map((s) => {
      const flags: string[] = [];
      if (s.autoCreated) flags.push("autoCreated");
      if (s.version) flags.push(`v${s.version}`);
      const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      const desc = s.description.trim() ? s.description.trim() : "(no description)";
      return `- ${s.name}${suffix}: ${desc}`;
    })
    .join("\n");
}
