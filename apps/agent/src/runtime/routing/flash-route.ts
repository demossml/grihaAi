import type {
  FlashRouterDeps,
  RoutingContext,
  RoutingDecision,
} from "./types.js";
import { fallbackRoute } from "./rule-route.js";

export const FLASH_ROUTER_SYSTEM = `You are a routing classifier for Griha AI. Return ONLY valid JSON (no markdown) with keys: role: "flash" | "main" | "vision" complexity: "trivial" | "simple" | "medium" | "complex" kind: "chat_reply" | "tool_orchestration" | "report_dispatch" | "analysis" | "vision_ocr" | "compression" | "other" confidence: number 0..1 reason: short english snake_case

Rules:

- report, expenses, totals, purchases, sums → role flash, kind report_dispatch, complexity trivial or simple
- image or ocr → role vision, kind vision_ocr
- deep analysis, compare, why → role main, kind analysis, complexity complex
- short casual chat → role flash, complexity trivial or simple
- NEVER invent chat ids or access rights
- NEVER invent money amounts
`;

export function buildFlashUserPayload(ctx: RoutingContext): string {
  // ONLY short fields — no history
  return JSON.stringify({
    userText: (ctx.userText ?? "").slice(0, 1500),
    hasImage: !!ctx.hasImage,
    hasVoice: !!ctx.hasVoice,
    hostHint: ctx.hostHint ?? "unknown",
    chatType: ctx.chatType ?? "unknown",
  });
}

export function parseFlashDecision(raw: string): RoutingDecision | null {
  try {
    let s = raw.trim();
    // strip ```json fences if model adds them
    if (s.startsWith("```")) {
      s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const obj = JSON.parse(s) as Record<string, unknown>;
    const role = obj.role;
    const complexity = obj.complexity;
    const kind = obj.kind;
    if (role !== "flash" && role !== "main" && role !== "vision") return null;
    if (
      complexity !== "trivial" &&
      complexity !== "simple" &&
      complexity !== "medium" &&
      complexity !== "complex"
    )
      return null;
    const k = typeof kind === "string" ? kind : "other";
    const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0));
    const reason =
      typeof obj.reason === "string" ? obj.reason.slice(0, 80) : "flash_parsed";
    return {
      role,
      complexity,
      kind: k as RoutingDecision["kind"],
      confidence,
      source: "flash_llm",
      reason,
    };
  } catch {
    return null;
  }
}

export type FlashErrorCode =
  | "timeout"
  | "http_401"
  | "http_4xx"
  | "http_5xx"
  | "parse"
  | "empty"
  | "network"
  | "no_api_key"
  | "unknown";

/** Классифицировать ошибку Flash-вызова (без логирования headers/body с ключами). */
export function classifyFlashError(err: unknown): { code: FlashErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "timeout", message };
  }
  const http = /flash_http_(\d+)/.exec(message);
  if (http) {
    const status = Number(http[1]);
    if (status === 401) return { code: "http_401", message };
    if (status >= 500) return { code: "http_5xx", message };
    if (status >= 400) return { code: "http_4xx", message };
  }
  if (/flash_empty_content/.test(message)) return { code: "empty", message };
  if (/no[_ ]api[_ ]?key|missing api key/i.test(message)) return { code: "no_api_key", message };
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|network/i.test(message)) {
    return { code: "network", message };
  }
  if (/JSON|parse|Unexpected token|SyntaxError/i.test(message)) {
    return { code: "parse", message };
  }
  return { code: "unknown", message };
}

/**
 * Дешёвый fallback при сбое Flash (не раздуваем короткий «ок/привет» до main/medium).
 * rule-route (report_dispatch/analysis/vision) уже вернул решение раньше — сюда
 * попадает только случай, когда Flash должен был классифицировать сам.
 */
function fallbackOnFlashError(ctx: RoutingContext): RoutingDecision {
  const text = (ctx.userText ?? "").trim();
  if (ctx.hasImage || ctx.hasVoice) {
    return fallbackRoute(ctx); // image → vision
  }
  if (text.length <= 80) {
    return {
      role: "main",
      complexity: "trivial",
      kind: "chat_reply",
      confidence: 0.3,
      source: "fallback",
      reason: "flash_error_short",
    };
  }
  // Длиннее: не medium, а simple (анализ/отчёт уже поймал rule-route).
  return {
    role: "main",
    complexity: "simple",
    kind: "chat_reply",
    confidence: 0.4,
    source: "fallback",
    reason: "flash_error_default",
  };
}

export async function routeWithFlash(
  ctx: RoutingContext,
  deps: FlashRouterDeps,
): Promise<RoutingDecision> {
  const messages = [
    { role: "system" as const, content: FLASH_ROUTER_SYSTEM },
    { role: "user" as const, content: buildFlashUserPayload(ctx) },
  ];
  try {
    const raw = await deps.callFlash(messages);
    const parsed = parseFlashDecision(raw);
    if (parsed && parsed.confidence >= 0.5) return parsed;
    return { ...fallbackRoute(ctx), reason: "flash_low_confidence_or_parse" };
  } catch (err) {
    const { code, message } = classifyFlashError(err);
    return {
      ...fallbackOnFlashError(ctx),
      reason: "flash_error",
      flashErrorCode: code,
      flashErrorMessage: message.slice(0, 200),
    };
  }
}
