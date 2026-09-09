import type { RuleKind, UserRule } from "@griha/shared-types";

/** Input for the Layer-1 pre-filter (no LLM involved). */
export interface RulePreFilterInput {
  chatId: string;
  fromUserId: string;
  text: string;
  /** Группа/супергруппа (require_mention и т.п. применяются только в группах). */
  isGroup?: boolean;
  /** Сообщение от бота (grammy from.is_bot). */
  fromIsBot?: boolean;
  /** Служебное сообщение (new_chat_members и т.п.). */
  isService?: boolean;
  /** Бот упомянут (mention/text_mention сам на себя). */
  botMentioned?: boolean;
  /** Сообщение — reply на сообщение бота. */
  repliedToBot?: boolean;
  /** Текст начинается с упоминания ДРУГОГО пользователя. */
  startsWithOtherMention?: boolean;
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

/** Текст начинается с @username (не самого бота) — для ignore_if_other_mention. */
export function startsWithMentionOfOtherUser(text: string, botUsername?: string): boolean {
  const match = /^\s*@([A-Za-z0-9_]+)/.exec(text);
  if (!match) return false;
  if (botUsername && match[1].toLowerCase() === botUsername.toLowerCase()) return false;
  return true;
}

/** Последнее (по порядку) значение structured-ключа среди hard rules. */
function hardValue(
  rules: UserRule[],
  key: string,
): string | boolean | number | undefined {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r.key === key && r.value !== null && r.value !== undefined) return r.value;
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

/**
 * Structured keys §9 (chat onboarding). Порядок важен; применяется только
 * при наличии structured-правил. Далее — legacy-эвристики по text.
 */
function evaluateStructuredRules(rules: UserRule[], input: RulePreFilterInput): boolean | null {
  const keys = new Set(rules.map((r) => r.key));
  if (keys.size === 0) return null; // structured-правил нет

  const has = (key: string) => keys.has(key);

  if (has("listen_only") && truthy(hardValue(rules, "listen_only"))) return false;

  if (has("ignore_bots") && hardValue(rules, "ignore_bots") !== false && input.fromIsBot) {
    return false;
  }
  if (has("ignore_service") && hardValue(rules, "ignore_service") !== false && input.isService) {
    return false;
  }

  if (has("only_my_messages") && truthy(hardValue(rules, "only_my_messages"))) {
    const onlyId = String(hardValue(rules, "only_my_messages_user_id") ?? "");
    if (!onlyId || String(input.fromUserId) !== onlyId) return false;
  }

  const requireMention = has("require_mention") && truthy(hardValue(rules, "require_mention"));
  const replyToBot = !has("reply_to_bot") || hardValue(rules, "reply_to_bot") !== false;
  if (input.isGroup && requireMention) {
    const mentioned = input.botMentioned === true;
    const isReply = replyToBot && input.repliedToBot === true;
    if (!mentioned && !isReply) return false;
  }

  if (input.isGroup && has("ignore_if_other_mention") && truthy(hardValue(rules, "ignore_if_other_mention"))) {
    if (input.startsWithOtherMention === true) return false;
  }

  return true;
}

/**
 * Layer 1: decide whether a message should reach the agent at all.
 * Returns false → stay silent (0 tokens). Pure JS, no LLM.
 */
export function shouldProcessMessage(
  hardRules: UserRule[],
  input: RulePreFilterInput,
): boolean {
  // Structured keys (пресеты) — в первую очередь.
  const structured = evaluateStructuredRules(hardRules, input);
  if (structured !== null) {
    if (structured === false) return false;
    // structured пропустил; legacy-эвристики всё ещё применяются ниже.
  }

  for (const rule of hardRules) {
    if (isOnlyOwnerRule(rule) && rule.ownerUserId) {
      if (input.fromUserId !== rule.ownerUserId) {
        return false;
      }
    }
  }
  return true;
}
