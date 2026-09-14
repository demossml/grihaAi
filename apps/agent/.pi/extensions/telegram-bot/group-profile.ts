/**
 * O1 (post-wiring, отдельный шаг) — групповой profile-override (§29).
 *
 * Правило чата `agent_profile` (key или текст "agent_profile: <id>")
 * переопределяет bot-level профиль для конкретной группы: persona-секция
 * профиля добавляется в rulesContext этого чата за флагом.
 * Flag off / нет правила / неизвестный профиль → секция пустая (1:1).
 */
import type { UserRule } from "@griha/shared-types";
import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import { buildProfileSection } from "../core-agent/profile-section.js";

const PROFILE_RULE_KEYS = new Set(["agent_profile", "profile"]);

/** Имя профиля из правил чата (первое активное правило выигрывает). */
export function ruleProfileName(rules: UserRule[]): string | undefined {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const key = rule.key?.trim().toLowerCase();
    if (key && PROFILE_RULE_KEYS.has(key)) {
      if (typeof rule.value === "string" && rule.value.trim()) {
        return rule.value.trim();
      }
    }
    // Текстовая форма: "agent_profile: accountant" / "profile=developer".
    const match = /^(?:agent_)?profile\s*[:=]\s*(\S+)/i.exec(rule.text ?? "");
    if (match) return match[1];
  }
  return undefined;
}

/** Секция группового профиля для rulesContext. Off/нет профиля → "". */
export function buildGroupProfileSection(
  env: NodeJS.ProcessEnv,
  rules: UserRule[],
): string {
  if (!isAgentRuntimeEnabled(env)) return "";
  const name = ruleProfileName(rules);
  if (!name) return "";
  return buildProfileSection(env, name).section;
}
