import type {
  ApprovalActionClass,
  FinancialApprovalPolicy,
} from "../types/index.js";

/**
 * Approval policy — pure classification and threshold logic.
 *
 * The LLM must never decide on its own whether a side-effect is safe; this
 * module is the single deterministic source of truth. Structured user policy
 * (approval-thresholds) always takes precedence over any model assumption.
 */

/** Action prefixes that are read-only and never require confirmation. */
const READ_ONLY_TOKENS = [
  "read",
  "grep",
  "find",
  "ls",
  "search",
  "get",
  "list",
  "status",
  "summarize",
  "analyze",
  "fetch",
  "show",
  "view",
];

/** Actions that are always explicit-confirmation, even with a permissive policy. */
const HIGH_RISK_TOKENS = [
  "send",
  "pay",
  "purchase",
  "buy",
  "wire",
  "transfer",
  "delete",
  "remove",
  "cancel",
  "publish",
  "post",
  "book",
  "approve",
  "grant",
  "sign",
  "reset",
];

const REVERSIBLE_TOKENS = ["add", "create", "update", "edit", "schedule", "rename", "draft", "write", "note"];

/** True when `token` appears as a whole segment (`_`/`.`/start/end delimited). */
function hasSegment(action: string, token: string): boolean {
  return new RegExp(`(^|[_.])${token}($|[_.])`).test(action);
}

export function classifyAction(action: string): ApprovalActionClass {
  const normalized = action.trim().toLowerCase();

  if (HIGH_RISK_TOKENS.some((s) => hasSegment(normalized, s))) {
    return "HIGH_RISK_IRREVERSIBLE";
  }

  if (READ_ONLY_TOKENS.some((p) => hasSegment(normalized, p))) {
    return "READ_ONLY";
  }

  if (REVERSIBLE_TOKENS.some((s) => hasSegment(normalized, s))) {
    return "REVERSIBLE_LOW_RISK";
  }

  return "SIDE_EFFECT";
}

export interface ApprovalDecision {
  required: boolean;
  actionClass: ApprovalActionClass;
  reason: string;
}

/**
 * Decide whether the given action requires approval, given an optional
 * financial policy (for monetary actions) and the action's amount/category.
 */
export function requiresApproval(
  action: string,
  options?: {
    amount?: number;
    currency?: string;
    category?: string;
    policy?: FinancialApprovalPolicy;
  },
): ApprovalDecision {
  const actionClass = classifyAction(action);

  if (actionClass === "READ_ONLY") {
    return { required: false, actionClass, reason: "Read-only action" };
  }

  if (actionClass === "HIGH_RISK_IRREVERSIBLE") {
    return {
      required: true,
      actionClass,
      reason: "High-risk / irreversible action always requires explicit approval",
    };
  }

  // Monetary action → financial threshold policy decides.
  if (options?.amount !== undefined) {
    return evaluateFinancialApproval(actionClass, {
      amount: options.amount,
      currency: options.currency,
      category: options.category,
      policy: options.policy,
    });
  }

  if (actionClass === "REVERSIBLE_LOW_RISK") {
    return {
      required: false,
      actionClass,
      reason: "Reversible, low-risk action (may run without confirmation)",
    };
  }

  return {
    required: true,
    actionClass,
    reason: "Side-effect action requires approval",
  };
}

function evaluateFinancialApproval(
  actionClass: ApprovalActionClass,
  options: { amount: number; currency?: string; category?: string; policy?: FinancialApprovalPolicy },
): ApprovalDecision {
  const { amount, category, policy } = options;

  // No policy → conservative: confirm.
  if (!policy) {
    return { required: true, actionClass, reason: "No financial approval policy set — confirming" };
  }

  if (category && policy.categoriesAlwaysConfirm?.includes(category)) {
    return {
      required: true,
      actionClass,
      reason: `Category "${category}" is in the always-confirm list`,
    };
  }

  if (policy.alwaysConfirmAbove !== undefined && amount >= policy.alwaysConfirmAbove) {
    return {
      required: true,
      actionClass,
      reason: `Amount ${amount} is at/above the always-confirm threshold ${policy.alwaysConfirmAbove}`,
    };
  }

  if (policy.autoApproveBelow !== undefined && amount <= policy.autoApproveBelow) {
    return {
      required: false,
      actionClass,
      reason: `Amount ${amount} is within the auto-approve threshold ${policy.autoApproveBelow}`,
    };
  }

  return {
    required: true,
    actionClass,
    reason: "Amount outside auto-approve range — confirming",
  };
}
