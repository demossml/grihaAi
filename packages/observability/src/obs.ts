import type { ObsEvent, ObsLevel, ObsSink } from "./types.js";
import { redactData } from "./redact.js";
import { createJsonlSink } from "./jsonl-sink.js";

export interface EmitInput {
  level?: ObsLevel;
  component: string;
  event: string;
  correlationId?: string;
  chatId?: string;
  threadId?: string;
  userId?: string;
  messageId?: number;
  updateId?: number;
  sessionKey?: string;
  durationMs?: number;
  ok?: boolean;
  code?: string;
  data?: Record<string, unknown>;
}

let sink: ObsSink | null = null;

export function isObsEnabled(): boolean {
  return process.env.GRIHA_OBS !== "0";
}

export function initObs(opts?: { sink?: ObsSink; dir?: string }): void {
  if (!isObsEnabled()) {
    sink = { write() {} };
    return;
  }
  sink = opts?.sink ?? createJsonlSink({ dir: opts?.dir });
}

export function getSink(): ObsSink {
  if (!sink) initObs();
  return sink!;
}

/** Для тестов: сбросить singleton. */
export function resetObsForTests(): void {
  sink = null;
}

export function emit(input: EmitInput): void {
  if (process.env.GRIHA_OBS === "0") return;
  if (!sink) initObs();
  const event: ObsEvent = {
    ts: new Date().toISOString(),
    level: input.level ?? "info",
    component: input.component,
    event: input.event,
    correlationId: input.correlationId,
    chatId: input.chatId,
    threadId: input.threadId,
    userId: input.userId,
    messageId: input.messageId,
    updateId: input.updateId,
    sessionKey: input.sessionKey,
    durationMs: input.durationMs,
    ok: input.ok,
    code: input.code,
    data: redactData(input.data),
  };
  try {
    void sink!.write(event);
  } catch {
    // никогда не бросать в caller
  }
}
