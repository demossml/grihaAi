/**
 * PROMPT 06 — structured extraction custom-правил из естественного языка.
 *
 * Flow: user text → LLM (только structured JSON) → JSON schema validation →
 * semantic validation → preview → явное подтверждение → SQLite.
 *
 * Custom rules — policy DATA, не код: LLM не выполняет действий, не пишет БД,
 * а schema не содержит полей security/ACL/tools/filesystem/SQL — они
 * невыразимы в принципе (unknown keys отклоняются).
 */
import type { PresetRule, RuleKey } from "./RulePresets.js";

export interface PolicyPatch {
  archive?: { text?: boolean; photo?: boolean; document?: boolean; voice?: boolean };
  processing?: { photoOcr?: boolean; documentOcr?: boolean; voiceStt?: boolean };
  response?: { mode?: "never" | "mention" | "reply" | "mention_or_reply" | "always" };
}

const RESPONSE_MODES = ["never", "mention", "reply", "mention_or_reply", "always"] as const;

const ALLOWED_KEYS = new Set([
  "archive",
  "processing",
  "response",
  "archive.text",
  "archive.photo",
  "archive.document",
  "archive.voice",
  "processing.photoOcr",
  "processing.documentOcr",
  "processing.voiceStt",
  "response.mode",
]);

function isBool(v: unknown): v is boolean {
  return v === true || v === false;
}

/**
 * JSON schema + semantic validation. Unknown keys → ошибка (защита от
 * «удали базу», «отключи ACL», «запусти shell» — им негде поместиться).
 */
export function validatePolicyPatch(raw: unknown): { patch?: PolicyPatch; error?: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "не объект" };
  }
  const obj = raw as Record<string, unknown>;
  const patch: PolicyPatch = {};
  const topLevel = Object.keys(obj);
  const allowedTop = new Set(["archive", "processing", "response"]);
  for (const k of topLevel) {
    if (!allowedTop.has(k)) return { error: `недопустимое поле: ${k}` };
  }

  if ("archive" in obj) {
    const a = obj.archive as Record<string, unknown>;
    const out: NonNullable<PolicyPatch["archive"]> = {};
    for (const k of Object.keys(a)) {
      if (!["text", "photo", "document", "voice"].includes(k)) {
        return { error: `недопустимое поле archive.${k}` };
      }
      if (!isBool(a[k])) return { error: `archive.${k} должен быть boolean` };
      (out as Record<string, boolean>)[k] = a[k] as boolean;
    }
    patch.archive = out;
  }
  if ("processing" in obj) {
    const p = obj.processing as Record<string, unknown>;
    const out: NonNullable<PolicyPatch["processing"]> = {};
    for (const k of Object.keys(p)) {
      if (!["photoOcr", "documentOcr", "voiceStt"].includes(k)) {
        return { error: `недопустимое поле processing.${k}` };
      }
      if (!isBool(p[k])) return { error: `processing.${k} должен быть boolean` };
      (out as Record<string, boolean>)[k] = p[k] as boolean;
    }
    patch.processing = out;
  }
  if ("response" in obj) {
    const r = obj.response as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (k !== "mode") return { error: `недопустимое поле response.${k}` };
    }
    if (r.mode !== undefined) {
      if (typeof r.mode !== "string" || !RESPONSE_MODES.includes(r.mode as never)) {
        return { error: `response.mode должен быть одним из ${RESPONSE_MODES.join("|")}` };
      }
      patch.response = { mode: r.mode as NonNullable<PolicyPatch["response"]>["mode"] };
    }
  }
  void ALLOWED_KEYS; // явная регистрация допустимых ключей выше
  return { patch };
}

/** LLM → только JSON (ничего кроме structured object). */
export function buildExtractionPrompt(text: string): string {
  return [
    "Ты извлекаешь правила Telegram-чата из текста пользователя.",
    "Верни ТОЛЬКО JSON без пояснений, строго по схеме:",
    '{"archive":{"text":bool,"photo":bool,"document":bool,"voice":bool},',
    '"processing":{"photoOcr":bool,"documentOcr":bool,"voiceStt":bool},',
    '"response":{"mode":"never|mention|reply|mention_or_reply|always"}}',
    "Поля, которых нет в тексте — пропускай.",
    "Никаких других полей (никакого shell, tools, ACL, filesystem, SQL).",
    `Текст пользователя: «${text}»`,
  ].join("\n");
}

/** Парсинг JSON из ответа LLM (с толерантностью к markdown-обёртке). */
export function parseLlmJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM вернул не JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Полный flow: LLM → validate → patch. null = извлечь ничего не удалось
 * (не ошибка — вызывающий падает на детерминированный парсер).
 */
export async function extractPolicyPatch(
  text: string,
  llm: (prompt: string) => Promise<string>,
): Promise<PolicyPatch | null> {
  let raw: unknown;
  try {
    const json = await llm(buildExtractionPrompt(text));
    raw = parseLlmJson(json);
  } catch {
    return null;
  }
  const { patch, error } = validatePolicyPatch(raw);
  if (error || !patch) return null;
  const hasAny =
    patch.archive || patch.processing || patch.response?.mode !== undefined;
  return hasAny ? patch : null;
}

/** Policy patch → structured rules (поверх safe_default, как в пресетах). */
export function policyPatchToRules(patch: PolicyPatch): PresetRule[] {
  const rules: PresetRule[] = [];
  const boolRule = (key: RuleKey, v: boolean | undefined) => {
    if (v === undefined) return;
    rules.push({ key, value: v, kind: "hard" });
  };
  boolRule("archive_media", patch.archive?.photo ?? patch.archive?.document ?? patch.archive?.voice);
  if (patch.archive?.text) {
    // текстовый архив = слушатель; фото/документы/голос — отдельные ключи.
    rules.push({ key: "listen_only", value: true, kind: "hard" });
  }
  if (patch.archive?.photo !== undefined || patch.archive?.document !== undefined || patch.archive?.voice !== undefined) {
    rules.push({ key: "archive_media", value: true, kind: "hard" });
  }
  boolRule("archive_ocr_ingest", patch.processing?.photoOcr ?? patch.processing?.documentOcr);
  if (patch.processing?.voiceStt !== undefined) {
    rules.push({ key: "archive_media", value: true, kind: "hard" });
  }
  if (patch.response?.mode) {
    const mode = patch.response.mode;
    if (mode === "never") {
      rules.push({ key: "require_mention", value: true, kind: "hard" });
      rules.push({ key: "listen_only", value: true, kind: "hard" });
    } else if (mode === "mention") {
      rules.push({ key: "require_mention", value: true, kind: "hard" });
      rules.push({ key: "reply_to_bot", value: false, kind: "hard" });
    } else if (mode === "reply") {
      rules.push({ key: "require_mention", value: false, kind: "hard" });
      rules.push({ key: "reply_to_bot", value: true, kind: "hard" });
    } else if (mode === "mention_or_reply") {
      rules.push({ key: "require_mention", value: true, kind: "hard" });
      rules.push({ key: "reply_to_bot", value: true, kind: "hard" });
    } else if (mode === "always") {
      rules.push({ key: "require_mention", value: false, kind: "hard" });
      rules.push({ key: "reply_to_bot", value: false, kind: "hard" });
    }
  }
  return rules;
}

/** Превью для пользователя (перед явным подтверждением). */
export function previewPolicyPatch(patch: PolicyPatch): string {
  const lines: string[] = ["Я понял правила так:"];
  if (patch.archive?.text) lines.push("• Слушать сообщения всех участников (архив текста)");
  if (patch.archive?.photo) lines.push("• Фотографии сохранять");
  if (patch.archive?.document) lines.push("• Документы сохранять");
  if (patch.archive?.voice) lines.push("• Голосовые сохранять");
  if (patch.processing?.photoOcr) lines.push("• Фотографии распознавать (OCR)");
  if (patch.processing?.documentOcr) lines.push("• Документы распознавать (OCR)");
  if (patch.processing?.voiceStt) lines.push("• Голосовые транскрибировать");
  const modeLabel: Record<string, string> = {
    never: "• Отвечать: никогда (только слушать)",
    mention: "• Отвечать только на @упоминание",
    reply: "• Отвечать только на reply",
    mention_or_reply: "• Отвечать на @упоминание или reply",
    always: "• Отвечать всегда",
  };
  if (patch.response?.mode) lines.push(modeLabel[patch.response.mode]);
  if (lines.length === 1) lines.push("• (ничего не изменилось)");
  return lines.join("\n");
}
