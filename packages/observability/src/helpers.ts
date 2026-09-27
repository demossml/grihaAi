import { emit } from "./obs.js";
import type { EmitInput } from "./obs.js";

/**
 * Observability v2 — типизированные emit-хелперы для консистентных событий.
 * Все вызовы fail-safe (emit никогда не бросает).
 */

export function emitTurnStart(
  p: Omit<EmitInput, "component" | "event">,
): void {
  emit({ ...p, level: "info", component: "telegram.turn", event: "turn.start" });
}

export function emitTurnEnd(
  p: Omit<EmitInput, "component" | "event"> & {
    ok: boolean;
    code?: string;
    durationMs?: number;
  },
): void {
  emit({
    ...p,
    level: p.ok ? "info" : "warn",
    component: "telegram.turn",
    event: "turn.end",
  });
}

export function emitGenerationBudget(p: {
  correlationId?: string;
  chatId?: string;
  sessionKey?: string;
  data: Record<string, unknown>;
}): void {
  emit({
    level: "info",
    component: "runtime.generation",
    event: "generation.budget",
    correlationId: p.correlationId,
    chatId: p.chatId,
    sessionKey: p.sessionKey,
    data: p.data,
  });
}

export function emitGenerationFinish(p: {
  correlationId?: string;
  chatId?: string;
  sessionKey?: string;
  ok: boolean;
  code?: string;
  data?: Record<string, unknown>;
}): void {
  emit({
    level: p.ok ? "info" : "warn",
    component: "runtime.generation",
    event: "generation.finish",
    correlationId: p.correlationId,
    chatId: p.chatId,
    sessionKey: p.sessionKey,
    ok: p.ok,
    code: p.code,
    data: p.data,
  });
}

// ── P0 spans: timeline одного хода (span.start/end + обёртка withSpan) ──

/** Машиночитаемый id спана (`${correlationId}:${span}:${timestamp36}`). */
export function newSpanId(correlationId: string, span: string): string {
  return `${correlationId}:${span}:${Date.now().toString(36)}`;
}

export function emitSpanStart(input: {
  correlationId: string;
  span: string;
  spanId: string;
  chatId?: string;
  sessionKey?: string;
  data?: Record<string, unknown>;
}): void {
  emit({
    level: "debug",
    component: "span",
    event: "span.start",
    correlationId: input.correlationId,
    chatId: input.chatId,
    sessionKey: input.sessionKey,
    data: { span: input.span, spanId: input.spanId, ...input.data },
  });
}

export function emitSpanEnd(input: {
  correlationId: string;
  span: string;
  spanId: string;
  ok: boolean;
  durationMs: number;
  chatId?: string;
  sessionKey?: string;
  code?: string;
  data?: Record<string, unknown>;
}): void {
  emit({
    level: input.ok ? "debug" : "warn",
    component: "span",
    event: "span.end",
    correlationId: input.correlationId,
    chatId: input.chatId,
    sessionKey: input.sessionKey,
    ok: input.ok,
    code: input.code,
    durationMs: input.durationMs,
    data: { span: input.span, spanId: input.spanId, ...input.data },
  });
}

/**
 * Обёртка: span.start → fn() → span.end (ok:true) / span.end (ok:false) + rethrow.
 * Никогда не глотает throw без span.end. emit() внутри fail-safe (не бросает).
 */
export async function withSpan<T>(
  meta: { correlationId: string; span: string; chatId?: string; sessionKey?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const spanId = newSpanId(meta.correlationId, meta.span);
  emitSpanStart({
    correlationId: meta.correlationId,
    span: meta.span,
    spanId,
    chatId: meta.chatId,
    sessionKey: meta.sessionKey,
  });
  const startedAt = Date.now();
  try {
    const result = await fn();
    emitSpanEnd({
      correlationId: meta.correlationId,
      span: meta.span,
      spanId,
      ok: true,
      durationMs: Date.now() - startedAt,
      chatId: meta.chatId,
      sessionKey: meta.sessionKey,
    });
    return result;
  } catch (e) {
    emitSpanEnd({
      correlationId: meta.correlationId,
      span: meta.span,
      spanId,
      ok: false,
      durationMs: Date.now() - startedAt,
      code: e instanceof Error ? e.name : "error",
      chatId: meta.chatId,
      sessionKey: meta.sessionKey,
    });
    throw e;
  }
}
