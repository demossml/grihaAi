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
  /**
   * R1: false в группе → SILENT (онбординг не завершён). Для private
   * игнорируется (R6). Bridge обязан передавать boolean для group/supergroup.
   */
  groupConfigured?: boolean;
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
 *
 * Архивариус (listen_only=true): сообщение ОБРАБАТЫВАЕТСЯ (доходит до агента и
 * архива), но текстовый ответ подавляется без явного @mention — см.
 * `evaluatePreFilter` (полная форма решения «обрабатывать, но не отвечать»).
 */
export function shouldProcessMessage(
  hardRules: UserRule[],
  input: RulePreFilterInput,
): boolean {
  return evaluatePreFilter(hardRules, input).process;
}

/** Полная форма решения Layer-1 (для TelegramBridge). */
export interface PreFilterOutcome {
  /** Пропустить сообщение к обработке (агент/архив). */
  process: boolean;
  /** Подавить текстовый ответ в чат (архивариус без @mention). */
  suppressReply: boolean;
  /** Архивный режим (listen_only): сохранять текст/медиа в chat_archive. */
  archive: boolean;
}

const BLOCKED: PreFilterOutcome = { process: false, suppressReply: false, archive: false };

export function evaluatePreFilter(
  hardRules: UserRule[],
  input: RulePreFilterInput,
): PreFilterOutcome {
  // R1 / R6: pending-группа молчит (0 токенов LLM), даже на @mention.
  if (input.isGroup && input.groupConfigured === false) return BLOCKED;

  // Structured keys (пресеты) — в первую очередь.
  const keys = new Set(hardRules.map((r) => r.key));
  const has = (key: string) => keys.has(key);

  // ── Архивариус (listen_only): обрабатывать всё, отвечать только на @mention. ──
  if (has("listen_only") && truthy(hardValue(hardRules, "listen_only"))) {
    // Прочие фильтры сохраняются: игнор ботов и сервисных сообщений.
    if (has("ignore_bots") && hardValue(hardRules, "ignore_bots") !== false && input.fromIsBot) {
      return BLOCKED;
    }
    if (has("ignore_service") && hardValue(hardRules, "ignore_service") !== false && input.isService) {
      return BLOCKED;
    }
    if (has("only_my_messages") && truthy(hardValue(hardRules, "only_my_messages"))) {
      const onlyId = String(hardValue(hardRules, "only_my_messages_user_id") ?? "");
      if (!onlyId || String(input.fromUserId) !== onlyId) return BLOCKED;
    }
    // require_mention/ignore_if_other_mention в режиме архива НЕ блокируют:
    // сообщение без @mention должно быть сохранено; блокируется только ответ.
    return {
      process: true,
      // Решение: только явный @mention считается обращением (reply — нет).
      suppressReply: input.botMentioned !== true,
      archive: input.isGroup === true,
    };
  }

  const structured = evaluateStructuredRules(hardRules, input);
  if (structured === false) return BLOCKED;

  for (const rule of hardRules) {
    if (isOnlyOwnerRule(rule) && rule.ownerUserId) {
      if (input.fromUserId !== rule.ownerUserId) return BLOCKED;
    }
  }
  return { process: true, suppressReply: false, archive: false };
}
