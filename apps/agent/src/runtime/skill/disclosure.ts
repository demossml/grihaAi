/**
 * Phase 6 (Item 6.1, матрица F1) — progressive disclosure.
 *
 * §13 master spec: не загружать все skills в каждый context; уровни 0/1/2.
 * Чистые функции; wiring в формирование промпта — за флагом.
 */

export interface SkillDescriptor {
  name: string;
  description: string;
  /** Параметры/входы (краткий список). */
  parameters: string[];
  /** Полное тело скилла (инструкции). */
  body: string;
}

export type DisclosureLevel = 0 | 1 | 2;

/** Level 0: имя + описание (для discovery/ranking). */
export function discloseLevel0(skill: SkillDescriptor): string {
  return `${skill.name}: ${skill.description}`;
}

/** Level 1: + параметры (для выбора кандидата). */
export function discloseLevel1(skill: SkillDescriptor): string {
  const params = skill.parameters.length > 0 ? `\nПараметры: ${skill.parameters.join(", ")}` : "";
  return `${discloseLevel0(skill)}${params}`;
}

/** Level 2: полное тело (загружается только выбранному скиллу). */
export function discloseLevel2(skill: SkillDescriptor): string {
  const params = skill.parameters.length > 0 ? `\nПараметры: ${skill.parameters.join(", ")}\n` : "\n";
  return `${skill.name}: ${skill.description}${params}${skill.body}`;
}

/** Единая точка progressive disclosure. Неверный уровень → throw. */
export function discloseSkill(skill: SkillDescriptor, level: DisclosureLevel): string {
  if (level === 0) return discloseLevel0(skill);
  if (level === 1) return discloseLevel1(skill);
  if (level === 2) return discloseLevel2(skill);
  throw new Error(`unknown disclosure level: ${level}`);
}
