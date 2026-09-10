/**
 * RulePresets — чистые данные + pure functions (легко тестировать).
 * Пресеты пишутся в User Rules как structured rules (key/value), scope=chat.
 */
import type { UserRule } from "@griha/shared-types";
import type { InlineButton } from "../../../src/utils/telegram/session-files.js";

export type RuleKey =
  | "require_mention"
  | "reply_to_bot"
  | "ignore_bots"
  | "ignore_service"
  | "ignore_if_other_mention"
  | "listen_only"
  | "only_my_messages"
  | "only_my_messages_user_id"
  | "language_mirror"
  | "style"
  | "length"
  | "memory_write"
  | "no_hallucinate_data"
  | "archive_media"
  | "archive_ocr_ingest"
  | "notify_poor_ocr";

export type RuleValue = boolean | string;

export interface PresetRule {
  key: RuleKey;
  value: RuleValue;
  kind: "hard" | "soft";
}

export type PresetId = "safe_default" | "team" | "secretary" | "listener" | "shop" | "only_me";

export const PRESETS: Record<PresetId, { title: string; description: string; rules: PresetRule[] }> = {
  safe_default: {
    title: "Безопасный режим",
    description: "До настройки: только @mention и reply",
    rules: [
      { key: "require_mention", value: true, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "ignore_if_other_mention", value: true, kind: "hard" },
      { key: "listen_only", value: false, kind: "hard" },
      { key: "only_my_messages", value: false, kind: "hard" },
      { key: "language_mirror", value: true, kind: "soft" },
    ],
  },
  team: {
    title: "Участник команды",
    description: "Отвечаю по @ или reply, деловой стиль, кратко",
    rules: [
      { key: "require_mention", value: true, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "ignore_if_other_mention", value: true, kind: "hard" },
      { key: "listen_only", value: false, kind: "hard" },
      { key: "only_my_messages", value: false, kind: "hard" },
      { key: "language_mirror", value: true, kind: "soft" },
      { key: "style", value: "formal", kind: "soft" },
      { key: "length", value: "short", kind: "soft" },
      { key: "memory_write", value: true, kind: "soft" },
      { key: "no_hallucinate_data", value: true, kind: "soft" },
    ],
  },
  secretary: {
    title: "Секретарь в группе",
    description: "По @/reply, можно запоминать, краткие ответы",
    rules: [
      { key: "require_mention", value: true, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "listen_only", value: false, kind: "hard" },
      { key: "only_my_messages", value: false, kind: "hard" },
      { key: "language_mirror", value: true, kind: "soft" },
      { key: "style", value: "concise", kind: "soft" },
      { key: "length", value: "short", kind: "soft" },
      { key: "memory_write", value: true, kind: "soft" },
    ],
  },
  listener: {
    title: "Слушатель",
    description: "Архивирую всё, отвечаю только по @mention",
    rules: [
      { key: "listen_only", value: true, kind: "hard" },
      { key: "archive_media", value: true, kind: "hard" },
      { key: "archive_ocr_ingest", value: true, kind: "hard" },
      { key: "require_mention", value: true, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "memory_write", value: true, kind: "soft" },
      { key: "notify_poor_ocr", value: false, kind: "soft" },
      { key: "language_mirror", value: true, kind: "soft" },
    ],
  },
  shop: {
    title: "Магазин / API",
    description: "Только по @, без выдуманных цифр, кратко",
    rules: [
      { key: "require_mention", value: true, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "listen_only", value: false, kind: "hard" },
      { key: "language_mirror", value: true, kind: "soft" },
      { key: "style", value: "formal", kind: "soft" },
      { key: "length", value: "short", kind: "soft" },
      { key: "no_hallucinate_data", value: true, kind: "soft" },
      { key: "memory_write", value: false, kind: "soft" },
    ],
  },
  only_me: {
    title: "Только мои сообщения",
    description: "В этой группе отвечаю только тому, кто настроил",
    rules: [
      { key: "require_mention", value: false, kind: "hard" },
      { key: "reply_to_bot", value: true, kind: "hard" },
      { key: "only_my_messages", value: true, kind: "hard" },
      { key: "ignore_bots", value: true, kind: "hard" },
      { key: "ignore_service", value: true, kind: "hard" },
      { key: "listen_only", value: false, kind: "hard" },
      { key: "language_mirror", value: true, kind: "soft" },
      { key: "style", value: "concise", kind: "soft" },
    ],
  },
};

/** Полный список правил пресета; для only_me добавляет привязку к actor. */
export function presetRulesWithActor(presetId: PresetId, actorId: string): PresetRule[] {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`unknown preset ${presetId}`);
  const rules = [...preset.rules];
  if (presetId === "only_me") {
    rules.push({ key: "only_my_messages_user_id", value: actorId, kind: "hard" });
  }
  return dedupeByKey(rules);
}

/** Последнее значение ключа побеждает (дубликаты от пресетов/парсера). */
export function dedupeByKey(rules: PresetRule[]): PresetRule[] {
  const map = new Map<string, PresetRule>();
  for (const r of rules) map.set(r.key, { ...r });
  return [...map.values()];
}

/**
 * Детерминированный парсер текста custom-правил (без LLM): поверх
 * safe_default накладывает распознанные фразы.
 */
export function parseCustomRulesText(text: string, actorId: string): PresetRule[] {
  const t = text.toLowerCase();
  const rules: PresetRule[] = [...PRESETS.safe_default.rules];

  if (/только мои|only my/.test(t)) {
    rules.push({ key: "only_my_messages", value: true, kind: "hard" });
    rules.push({ key: "only_my_messages_user_id", value: actorId, kind: "hard" });
  }
  if (/слушатель|не отвечай|молч|только читай/.test(t)) {
    rules.push({ key: "listen_only", value: true, kind: "hard" });
  }
  if (/без @|без упоминания|всегда отвечай|на все сообщения/.test(t)) {
    rules.push({ key: "require_mention", value: false, kind: "hard" });
  }
  if (/кратко|коротко|сжато/.test(t)) {
    rules.push({ key: "length", value: "short", kind: "soft" });
  }
  if (/деловом|официал|formal/.test(t)) {
    rules.push({ key: "style", value: "formal", kind: "soft" });
  }
  return dedupeByKey(rules);
}

export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildOnboardingText(chatTitle: string): string {
  return (
    `Меня добавили в группу «${escapeHtml(chatTitle)}».` +
    `\n\nКак мне здесь работать?\nВыберите сценарий — правила применятся сразу.`
  );
}

const ONBOARDING_BUTTONS: Array<{ label: string; action: string }> = [
  { label: "Участник команды", action: "p:team" },
  { label: "Секретарь в группе", action: "p:secretary" },
  { label: "Слушатель", action: "p:listener" },
  { label: "Магазин / API", action: "p:shop" },
  { label: "Только мои сообщения", action: "p:only_me" },
  { label: "Настроить самому", action: "custom" },
  { label: "Оставить как есть", action: "skip" },
];

/** Кнопки онбординга: callback data = cs:{chatId}:{action} (≤64 байт). */
export function buildOnboardingKeyboard(chatId: string): InlineButton[][] {
  return ONBOARDING_BUTTONS.map((b) => [
    { text: b.label, callbackData: `cs:${chatId}:${b.action}` },
  ]);
}

/** Подтверждение custom-правил: cs:{chatId}:confirm / cs:{chatId}:cancel. */
export function buildConfirmKeyboard(chatId: string): InlineButton[][] {
  return [
    [
      { text: "Подтвердить", callbackData: `cs:${chatId}:confirm` },
      { text: "Отмена", callbackData: `cs:${chatId}:cancel` },
    ],
  ];
}

/** Текстовое описание правил для подтверждения («Я понял так: …»). */
export function describeRules(rules: PresetRule[]): string {
  const lines = rules.map((r) => `- ${r.key} = ${String(r.value)} [${r.kind}]`);
  return `Я понял так:\n${lines.join("\n")}`;
}

/** Soft structured keys → короткий текст для system prompt (§10). */
export function formatSoftRulesForPrompt(rules: UserRule[]): string {
  const lines: string[] = [];
  for (const r of rules) {
    switch (r.key) {
      case "style":
        lines.push(`Style: ${r.value} (${r.value === "formal" ? "formal business tone" : "concise tone"}).`);
        break;
      case "length":
        lines.push("Keep answers concise.");
        break;
      case "no_hallucinate_data":
        lines.push("Do not invent numbers; use tools/data only.");
        break;
      case "memory_write":
        if (r.value === false) lines.push("Do not write new memories from this chat.");
        break;
      case "language_mirror":
        lines.push("Mirror the user's language.");
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}
