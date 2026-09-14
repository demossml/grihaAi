/**
 * F7 (post-wiring, матрица F7) — slash-команды по скиллам.
 *
 * Скилл объявляет команды во фронтматтере (`commands: [a, b]`). Здесь —
 * чистая коллекция валидных уникальных команд; регистрация в core-agent —
 * только за флагом `HERMES_AGENT_RUNTIME` (off = команд нет, 1:1).
 */
import type { SkillMeta } from "@griha/skills";

export interface SkillCommand {
  /** Имя со слэшем, напр. "/report". */
  name: string;
  skillName: string;
  description: string;
}

const COMMAND_PATTERN = /^[a-z0-9_-]{1,32}$/i;

/**
 * Валидные уникальные команды скиллов (первый скилл выигрывает при коллизии;
 * невалидные имена отбрасываются).
 */
export function collectSkillCommands(skills: SkillMeta[]): SkillCommand[] {
  const seen = new Set<string>();
  const commands: SkillCommand[] = [];
  for (const skill of skills) {
    for (const raw of skill.commands ?? []) {
      const name = raw.trim().replace(/^\/+/, "");
      if (!COMMAND_PATTERN.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      commands.push({
        name: `/${name}`,
        skillName: skill.name,
        description: skill.description,
      });
    }
  }
  return commands;
}
