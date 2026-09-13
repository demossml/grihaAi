/**
 * Phase 11 (Item 11.1, матрица K2 + §24/§25) — уровни риска действий.
 *
 * §24: authorization → risk classification → permission → approval →
 * sandbox → execution → audit. §25: все side effects классифицировать;
 * approval policy должна быть конфигурируемой.
 */

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export type ActionKind =
  | "read_file"
  | "list"
  | "write_file"
  | "send_message"
  | "delete_file"
  | "financial"
  | "system_modification"
  | "memory_write"
  | "skill_manage";

export interface ActionRisk {
  action: ActionKind;
  level: RiskLevel;
  reason: string;
}

/** §25: классификация side effects по умолчанию. */
export function classifyAction(action: ActionKind): ActionRisk {
  switch (action) {
    case "read_file":
    case "list":
      return { action, level: "safe", reason: "только чтение" };
    case "memory_write":
      return { action, level: "low", reason: "запись в память" };
    case "write_file":
    case "send_message":
      return { action, level: "medium", reason: "изменение состояния/внешний эффект" };
    case "delete_file":
      return { action, level: "high", reason: "необратимое удаление" };
    case "financial":
      return { action, level: "high", reason: "финансовое действие" };
    case "system_modification":
      return { action, level: "critical", reason: "модификация системы" };
    case "skill_manage":
      return { action, level: "medium", reason: "изменение скиллов (через versioning F3)" };
  }
}

export interface ApprovalPolicy {
  /** Действия с уровнем >= порога требуют одобрения. */
  approvalThreshold: RiskLevel;
  /** Исключения: действия, которые НИКОГДА не требуют одобрения. */
  alwaysAllow?: ActionKind[];
  /** Действия, которые ВСЕГДА требуют одобрения. */
  alwaysRequire?: ActionKind[];
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  approvalThreshold: "medium",
  alwaysAllow: ["read_file", "list"],
  alwaysRequire: ["system_modification", "financial"],
};

const RISK_ORDER: RiskLevel[] = ["safe", "low", "medium", "high", "critical"];

/** §25: решение об одобрении по конфигурируемой политике. */
export function requiresApproval(
  action: ActionKind,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): { required: boolean; risk: ActionRisk } {
  const risk = classifyAction(action);
  if (policy.alwaysRequire?.includes(action)) return { required: true, risk };
  if (policy.alwaysAllow?.includes(action)) return { required: false, risk };
  const required = RISK_ORDER.indexOf(risk.level) >= RISK_ORDER.indexOf(policy.approvalThreshold);
  return { required, risk };
}
