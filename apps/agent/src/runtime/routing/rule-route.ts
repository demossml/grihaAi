import type { RoutingContext, RoutingDecision } from "./types.js";

/**
 * Цельнословный поиск с учётом кириллицы.
 * `\b` в JS-регэкспах не видит кириллицу (\w = [A-Za-z0-9_]), поэтому
 * boundary считаем вручную: слово окружено не-буквенно-цифровыми символами.
 */
function hasWord(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  const needle = word.toLowerCase();
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    const before = idx === 0 ? "" : lower[idx - 1];
    const afterIdx = idx + needle.length;
    const after = afterIdx >= lower.length ? "" : lower[afterIdx];
    const isWordChar = (ch: string) => /[a-zа-яё0-9_]/i.test(ch);
    if (!isWordChar(before) && !isWordChar(after)) return true;
    idx = lower.indexOf(needle, idx + 1);
  }
  return false;
}

/**
 * Если возвращает Decision с confidence >= 0.8 — LLM Flash НЕ вызывать.
 * Если null — нужна Flash или fallback.
 */
export function tryRuleRoute(ctx: RoutingContext): RoutingDecision | null {
  const text = (ctx.userText ?? "").trim();

  // 1) Vision / OCR
  if (ctx.hasImage || ctx.hostHint === "ocr") {
    return {
      role: "vision",
      complexity: "simple",
      kind: "vision_ocr",
      confidence: 0.95,
      source: "rule",
      reason: "has_image_or_ocr_hint",
    };
  }

  // 2) Explicit report / expenses dispatch (host or keywords)
  if (
    ctx.hostHint === "report" ||
    ["отчёт", "отчет", "расход", "итог", "сумм", "сумма", "суммы", "expenses", "expense", "report"].some(
      (w) => hasWord(text, w),
    )
  ) {
    return {
      role: "flash",
      complexity: "trivial",
      kind: "report_dispatch",
      confidence: ctx.hostHint === "report" ? 0.95 : 0.85,
      source: "rule",
      reason: "report_keywords_or_hint",
    };
  }

  // 3) Very short chat
  if (text.length > 0 && text.length <= 40 && !ctx.hasImage) {
    return {
      role: "flash",
      complexity: "trivial",
      kind: "chat_reply",
      confidence: 0.8,
      source: "rule",
      reason: "short_text",
    };
  }

  // 4) Analysis keywords
  if (
    ctx.hostHint === "analysis" ||
    ["проанализируй", "сравни", "почему", "динамика", "анализ"].some((w) =>
      hasWord(text, w),
    )
  ) {
    return {
      role: "main",
      complexity: "complex",
      kind: "analysis",
      confidence: 0.85,
      source: "rule",
      reason: "analysis_keywords",
    };
  }

  return null; // need flash or fallback
}

export function fallbackRoute(ctx: RoutingContext): RoutingDecision {
  if (ctx.hasImage) {
    return {
      role: "vision",
      complexity: "simple",
      kind: "vision_ocr",
      confidence: 0.5,
      source: "fallback",
      reason: "fallback_image",
    };
  }
  return {
    role: "main",
    complexity: "medium",
    kind: "chat_reply",
    confidence: 0.4,
    source: "fallback",
    reason: "fallback_default_main",
  };
}
