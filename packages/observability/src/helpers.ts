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
