import type { RoutingContext, RoutingDecision } from "./types.js";

/**
 * Case-insensitive substring match (stems: «закупк», «сумм», «расход» и т.п.).
 * `\b` в JS-регэкспах не видит кириллицу, поэтому — `includes` по lowercased text.
 */
function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/** report_dispatch keywords (stems): отчёт/расход/закупки/итог/суммы. */
const REPORT_WORDS = [
  "отчёт", "отчет", "расход", "закупк", "итог", "сумм",
  "expenses", "report", "total",
];

/** analysis keywords: интеррогативные «почему/сравни» + анализ. */
const ANALYSIS_WORDS = [
  "проанализируй", "сравни", "почему", "динамика", "анализ",
  "analysis", "compare", "why",
];

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

  // 2) Analysis (интеррогативные «почему/сравни» приоритетнее отчёта:
  //    «Почему выросли расходы?» → analysis, а не report_dispatch).
  if (ctx.hostHint === "analysis" || hasAny(text, ANALYSIS_WORDS)) {
    return {
      role: "main",
      complexity: "complex",
      kind: "analysis",
      confidence: 0.85,
      source: "rule",
      reason: "analysis_keywords",
    };
  }

  // 3) Explicit report / expenses dispatch (host or keywords)
  if (ctx.hostHint === "report" || hasAny(text, REPORT_WORDS)) {
    return {
      role: "flash",
      complexity: "trivial",
      kind: "report_dispatch",
      confidence: ctx.hostHint === "report" ? 0.95 : 0.85,
      source: "rule",
      reason: "report_keywords_or_hint",
    };
  }

  // 4) Very short chat
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
