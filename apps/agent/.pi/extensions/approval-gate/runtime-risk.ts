import { isAgentRuntimeEnabled } from "../../../src/runtime/index.js";
import {
  requiresApproval,
  type ActionKind,
  type ActionRisk,
} from "../../../src/runtime/security/risk.js";
import type { ApprovalActionClass } from "../../../src/types/index.js";

/**
 * W8 (матрица K2) — подключение runtime risk-классификации к approval-gate.
 *
 * `approval_required` — свободная строка действия от LLM. Здесь она
 * маппится в ActionKind (K2) и прогоняется через runtime-политику
 * `requiresApproval` (§24/§25). Флаг off — старый finance-гейт решает всё
 * сам, runtime-часть полностью отключается (1:1 старое поведение).
 *
 * Неизвестное действие → null (runtime не имеет мнения; решает старый гейт).
 * Никогда не ослабляет решение: runtime может только ДОБАВИТЬ требование
 * одобрения, но не снять его.
 */

const FINANCIAL =
  /transfer|pay|payment|money|finance|invoice|expense|refund|перевод|оплат|плат(е|ё)ж|сч(е|ё)т/i;
const SYSTEM =
  /install|uninstall|system|service|restart|reboot|sudo|chmod|chown|systemctl|apt-get|\bapt\b|\bbrew\b|установ|систем|перезагруз/i;
const DELETE = /delete|remove|erase|rm\b|удал/i;
const WRITE =
  /write|save|create|append|edit|update\s+file|запис|сохран|созда|измен|файл/i;
const SEND = /send|message|notify|post|reply|отправ|сообщ|уведом/i;
const MEMORY = /memory|remember|запомн|память/i;
const SKILL = /skill|навык/i;
const READ = /read|list|get|search|view|show|\bcat\b|\bls\b|прочита|показ|поиск|список/i;

/** Маппинг свободной строки действия в ActionKind (K2). */
export function inferActionKind(action: string): ActionKind | null {
  const a = action.trim();
  if (!a) return null;
  if (FINANCIAL.test(a)) return "financial";
  if (SYSTEM.test(a)) return "system_modification";
  if (DELETE.test(a)) return "delete_file";
  if (SEND.test(a)) return "send_message";
  if (WRITE.test(a)) return "write_file";
  if (MEMORY.test(a)) return "memory_write";
  if (SKILL.test(a)) return "skill_manage";
  if (READ.test(a)) return "read_file";
  return null;
}

export interface RuntimeRiskVerdict {
  /** Флаг активен: runtime участвует в решении. */
  active: boolean;
  /** Runtime требует одобрения (никогда не ослабляет старый гейт). */
  required: boolean;
  risk?: ActionRisk;
}

/** Маппинг ActionKind → класс approval-запроса (схема ApprovalService). */
export function riskActionClass(kind: ActionKind): ApprovalActionClass {
  switch (kind) {
    case "financial":
    case "system_modification":
    case "delete_file":
      return "HIGH_RISK_IRREVERSIBLE";
    case "write_file":
    case "send_message":
    case "skill_manage":
      return "SIDE_EFFECT";
    case "memory_write":
      return "REVERSIBLE_LOW_RISK";
    case "read_file":
    case "list":
      return "READ_ONLY";
  }
}

/** Runtime-оценка действия: off → неактивен, unknown → нет мнения. */
export function evaluateRuntimeRisk(
  action: string,
  env: NodeJS.ProcessEnv,
): RuntimeRiskVerdict {
  if (!isAgentRuntimeEnabled(env)) {
    return { active: false, required: false };
  }
  const kind = inferActionKind(action);
  if (!kind) return { active: true, required: false };
  const verdict = requiresApproval(kind);
  return {
    active: true,
    required: verdict.required,
    risk: verdict.risk,
  };
}
