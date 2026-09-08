import type { RuleKind, UserRule } from "@griha/shared-types";

/** Input for the Layer-1 pre-filter (no LLM involved). */
export interface RulePreFilterInput {
  chatId: string;
  fromUserId: string;
  text: string;
}

/**
 * Heuristic kind detection for new rules (client may override via the tool).
 * Hard rules can be checked without an LLM; soft rules are style/tone only.
 */
export function detectKind(text: string): RuleKind {
  const lower = text.toLowerCase();
  const hardSignals = [
    "только на мои",
    "только мне",
    "только мои сообщения",
    "игнорируй",
    "не отвечай",
    "молч",
    "только от",
    "only my",
    "only me",
    "ignore others",
    "don't reply",
  ];
  if (hardSignals.some((s) => lower.includes(s))) return "hard";
  return "soft";
}

/** True when the rule is an "answer only to me / owner" restriction. */
export function isOnlyOwnerRule(rule: UserRule): boolean {
  const lower = rule.text.toLowerCase();
  return /(только (на )?мои|только мне|только от меня|отвечай только|only my|only me|only reply to me|ignore others|игнорируй других)/i.test(
    lower,
  );
}

/**
 * Layer 1: decide whether a message should reach the agent at all.
 * Returns false → stay silent (0 tokens). Pure JS, no LLM.
 */
export function shouldProcessMessage(
  hardRules: UserRule[],
  input: RulePreFilterInput,
): boolean {
  for (const rule of hardRules) {
    if (isOnlyOwnerRule(rule) && rule.ownerUserId) {
      if (input.fromUserId !== rule.ownerUserId) {
        return false;
      }
    }
  }
  return true;
}
