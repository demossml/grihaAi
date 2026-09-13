import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  createDefaultProfileRegistry,
  type AgentProfile,
} from "../../../src/runtime/profiles/profile.js";
import { validateProfile } from "../../../src/runtime/profiles/validation.js";

/**
 * W12 (матрица O1, §29) — выбор профиля бота за флагом.
 *
 * Bot-level: `config.profile` (id или имя §29-профиля) → секция persona в
 * system prompt через core-agent. Единый Agent Runtime: профиль меняет
 * persona/toolsets/modelRole-подсказки, но не заменяет runtime.
 * Flag off → секция пустая (1:1 старое поведение). Неизвестный/невалидный
 * профиль молча игнорируется (не ломает запуск).
 *
 * Групповой override (rulesContext `agent_profile`) — отдельный шаг
 * (требует изменения TG-слоя).
 */

export interface ProfileSectionResult {
  section: string;
  profileId?: string;
}

function renderProfile(profile: AgentProfile): string {
  const lines = [
    `## Agent profile: ${profile.name}`,
    profile.persona,
    `Model role: ${profile.modelRole}`,
    `Toolsets: ${profile.toolsets.join(", ")}`,
  ];
  if (profile.memoryPolicy) {
    lines.push(`Memory policy: ${JSON.stringify(profile.memoryPolicy)}`);
  }
  if (profile.automationPolicy) {
    lines.push(`Automation policy: ${JSON.stringify(profile.automationPolicy)}`);
  }
  return lines.join("\n");
}

/** Секция профиля для system prompt. Off/нет профиля → пустая строка. */
export function buildProfileSection(
  env: NodeJS.ProcessEnv,
  profileName?: string,
): ProfileSectionResult {
  if (!isAgentRuntimeEnabled(env)) return { section: "" };
  if (!profileName || profileName.trim().length === 0) return { section: "" };
  const registry = createDefaultProfileRegistry();
  const profile =
    registry.get(profileName) ?? registry.resolveByName(profileName);
  if (!profile) return { section: "" };
  const validation = validateProfile(profile);
  if (!validation.valid) return { section: "" };
  return { section: renderProfile(profile), profileId: profile.id };
}
