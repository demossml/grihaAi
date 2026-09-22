import type {
  FlashRouterDeps,
  RoutingContext,
  RoutingDecision,
} from "./types.js";
import { fallbackRoute } from "./rule-route.js";

export const FLASH_ROUTER_SYSTEM = `You are a routing classifier for Griha AI.
Return ONLY valid JSON (no markdown) with keys:
role: "flash" | "main" | "vision"
complexity: "trivial" | "simple" | "medium" | "complex"
kind: "chat_reply" | "tool_orchestration" | "report_dispatch" | "analysis" | "vision_ocr" | "compression" | "other"
confidence: number 0..1
reason: short english snake_case

Rules:
- report/expenses/sum/totals → role flash, kind report_dispatch, complexity trivial|simple
- image/ocr → role vision
- deep analysis/compare/why → role main, complexity complex, kind analysis
- short casual reply → role flash, complexity trivial|simple
- NEVER invent chat ids or claim access rights
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
  } catch {
    return { ...fallbackRoute(ctx), reason: "flash_error" };
  }
}
