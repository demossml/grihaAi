/**
 * Phase 15 (Item 15.2, матрица O1) — валидация профилей.
 *
 * Ссылочная целостность: toolsets существуют (§23), modelRole валидна
 * (Phase 2 union), persona непустая.
 */
import { MODEL_RUNTIME_ROLES, type ModelRuntimeRole } from "../model/types.js";
import { ALL_TOOLSETS, type Toolset } from "../toolsets/toolsets.js";
import type { AgentProfile } from "./profile.js";

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProfile(
  profile: AgentProfile,
): ProfileValidationResult {
  const errors: string[] = [];
  if (!profile.id || profile.id.trim().length === 0) errors.push("id пустой");
  if (!profile.name || profile.name.trim().length === 0) errors.push("name пустой");
  if (!profile.persona || profile.persona.trim().length === 0) errors.push("persona пустая");
  if (!MODEL_RUNTIME_ROLES.includes(profile.modelRole as ModelRuntimeRole)) {
    errors.push(`modelRole невалидна: ${profile.modelRole}`);
  }
  for (const toolset of profile.toolsets) {
    if (!ALL_TOOLSETS.includes(toolset as Toolset)) {
      errors.push(`toolset невалиден: ${toolset}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Валидация всех профилей реестра (для загрузки конфига). */
export function validateProfiles(profiles: readonly AgentProfile[]): ProfileValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) errors.push(`дубликат id: ${profile.id}`);
    seen.add(profile.id);
    errors.push(...validateProfile(profile).errors);
  }
  return { valid: errors.length === 0, errors };
}
