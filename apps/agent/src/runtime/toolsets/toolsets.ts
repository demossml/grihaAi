/**
 * Phase 12 (Item 12.2, матрица L2 + §23) — toolsets.
 *
 * §23: capability groups; subagent получает только разрешённые toolsets;
 * агент НЕ может добавить себе toolset (запрет самодобавления).
 */

export type Toolset =
  | "core"
  | "memory"
  | "web"
  | "coding"
  | "telegram"
  | "finance"
  | "crm"
  | "travel"
  | "delegation"
  | "cron"
  | "vision"
  | "mcp"
  | "admin";

export const ALL_TOOLSETS: readonly Toolset[] = [
  "core",
  "memory",
  "web",
  "coding",
  "telegram",
  "finance",
  "crm",
  "travel",
  "delegation",
  "cron",
  "vision",
  "mcp",
  "admin",
];

export interface ToolsetPolicy {
  /** Разрешённые toolsets (например, для subagent'а). */
  allowed: Toolset[];
  /** Кому разрешено менять политику (имена, не LLM). */
  adminActors: string[];
}

export const DEFAULT_TOOLSET_POLICY: ToolsetPolicy = {
  allowed: ["core", "memory"],
  adminActors: ["owner", "system"],
};

export interface ToolsetDecision {
  allowed: boolean;
  reason: string;
}

/** Проверка: может ли исполнитель использовать toolset. */
export function canUseToolset(
  toolset: Toolset,
  policy: ToolsetPolicy,
): ToolsetDecision {
  if (policy.allowed.includes(toolset)) {
    return { allowed: true, reason: `${toolset} в списке разрешённых` };
  }
  return { allowed: false, reason: `${toolset} не разрешён политикой` };
}

/**
 * Запрет самодобавления: LLM-агент (не admin) не может расширить политику.
 * Изменение политики — только adminActors.
 */
export function canModifyPolicy(
  actor: string,
  policy: ToolsetPolicy,
): { allowed: boolean; reason: string } {
  if (policy.adminActors.includes(actor)) {
    return { allowed: true, reason: `${actor} — admin` };
  }
  return { allowed: false, reason: `${actor} не может менять toolsets (запрет самодобавления)` };
}

/** Валидация запроса набора toolsets (например, при создании subagent'а). */
export function validateToolsetRequest(
  requested: readonly Toolset[],
  policy: ToolsetPolicy,
  actor: string,
): { allowed: boolean; denied: Toolset[]; reason: string } {
  if (!canModifyPolicy(actor, policy).allowed) {
    return {
      allowed: false,
      denied: [...requested],
      reason: `${actor} не может запрашивать toolsets`,
    };
  }
  const denied = requested.filter((t) => !policy.allowed.includes(t));
  if (denied.length > 0) {
    return { allowed: false, denied, reason: `toolsets вне политики: ${denied.join(", ")}` };
  }
  return { allowed: true, denied: [], reason: "ok" };
}
