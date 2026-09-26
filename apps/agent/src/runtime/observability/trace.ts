/**
 * Prompt 02 — Core AgentTrace / AgentTraceStep.
 *
 * Единая trace-структура одного agent-run. Встраивается ТОЛЬКО в реальный
 * orchestrator (TelegramSessionPool.runPrompt). Не ContextSource/ToolTrace/
 * metrics/TaskOutcome — это следующие промпты.
 *
 * Типы адаптированы под стиль проекта (mutable DTO, без branded-строк);
 * timestamp — ISO-8601 UTC. В `metadata` запрещены секреты/токены — весь
 * metadata прогоняется через `redactData` из @griha/observability.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { redactData } from "@griha/observability";
import type { FailureChainEntry, PrimaryFailure } from "./error-taxonomy.js";
import type { TaskOutcome } from "./task-outcome.js";

export type TraceId = string;
export type StepId = string;

export type AgentTraceStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "timeout";

export type AgentTraceStepType =
  | "input"
  | "context"
  | "retrieval"
  | "model"
  | "tool_call"
  | "tool_result"
  | "validation"
  | "retry"
  | "error"
  | "final";

export type AgentTraceStepStatus = "started" | "success" | "failed" | "skipped";

export interface AgentTraceStep {
  stepId: StepId;
  sequence: number;
  type: AgentTraceStepType;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: AgentTraceStepStatus;
  /** Уже redact-нутый metadata (без секретов/токенов). */
  metadata?: Record<string, unknown>;
}

export interface AgentTraceFinal {
  success: boolean;
  responseLength?: number;
  errorCode?: string;
  /** Prompt 07: реальный исход задачи (не только «модель не упала»). */
  taskOutcome?: TaskOutcome;
}

/** Prompt 07: одна повторная попытка (retry/fallback/…). */
export interface RetryTrace {
  attempt: number;
  kind: "retry" | "fallback" | "alternative_tool" | "new_model_call" | "full_restart";
  reason?: string;
  from?: string;
  to?: string;
}

export interface AgentTrace {
  traceId: TraceId;
  /** Существующий формат session ID (`tg:{userId}:{chatId}` и т.д.). */
  sessionId: string;
  startedAt: string;
  finishedAt?: string;
  userId?: string;
  chatId?: string;
  threadId?: string;
  taskType?: string;
  agentVersion: string;
  status: AgentTraceStatus;
  steps: AgentTraceStep[];
  /** Prompt 07: сколько раз была повторная попытка (retry/fallback). */
  retryCount: number;
  final?: AgentTraceFinal;
  /** Prompt 06: первичная причина провала (при status = failed). */
  primaryFailure?: PrimaryFailure;
  /** Prompt 06: упорядоченная цепочка шагов, приведших к провалу. */
  failureChain?: FailureChainEntry[];
}

export interface TraceStartInput {
  traceId: TraceId;
  sessionId: string;
  agentVersion: string;
  userId?: string;
  chatId?: string;
  threadId?: string;
  taskType?: string;
}

export interface TraceStepInput {
  type: AgentTraceStepType;
  status: AgentTraceStepStatus;
  metadata?: Record<string, unknown>;
  durationMs?: number;
}

/** In-memory менеджер одного trace (start → addStep → finish). */
export class TraceManager {
  private trace: AgentTrace | null = null;
  private stepSeq = 0;
  private readonly now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get current(): AgentTrace | null {
    return this.trace;
  }

  start(input: TraceStartInput): AgentTrace {
    this.trace = {
      traceId: input.traceId,
      sessionId: input.sessionId,
      startedAt: this.now(),
      userId: input.userId,
      chatId: input.chatId,
      threadId: input.threadId,
      taskType: input.taskType,
      agentVersion: input.agentVersion,
      status: "running",
      steps: [],
      retryCount: 0,
    };
    this.stepSeq = 0;
    return this.trace;
  }

  /** Append значимый шаг. Не бросает на redact (metadata всегда обезличен). */
  addStep(input: TraceStepInput): AgentTraceStep {
    if (!this.trace) throw new Error("trace not started");
    this.stepSeq += 1;
    const step: AgentTraceStep = {
      stepId: `${this.trace.traceId}.${this.stepSeq}`,
      sequence: this.stepSeq,
      type: input.type,
      startedAt: this.now(),
      status: input.status,
      metadata: input.metadata ? (redactData(input.metadata) as Record<string, unknown>) : undefined,
    };
    if (input.durationMs !== undefined) {
      step.durationMs = input.durationMs;
      step.finishedAt = new Date(Date.parse(step.startedAt) + input.durationMs).toISOString();
    }
    this.trace.steps.push(step);
    return step;
  }

  /** Завершить trace: статус + финал. Возвращает финальный объект. */
  finish(status: AgentTraceStatus, final?: AgentTraceFinal): AgentTrace {
    if (!this.trace) throw new Error("trace not started");
    this.trace.status = status;
    this.trace.finishedAt = this.now();
    if (final) this.trace.final = final;
    return this.trace;
  }

  /** Prompt 06: зафиксировать primaryFailure + failureChain. */
  setFailure(primaryFailure: PrimaryFailure, failureChain?: FailureChainEntry[]): void {
    if (!this.trace) throw new Error("trace not started");
    this.trace.primaryFailure = primaryFailure;
    if (failureChain) this.trace.failureChain = failureChain;
  }

  /** Prompt 07: зафиксировать повторную попытку (retry/fallback). */
  recordRetry(info: RetryTrace): AgentTraceStep {
    if (!this.trace) throw new Error("trace not started");
    this.trace.retryCount += 1;
    return this.addStep({
      type: "retry",
      status: "success",
      metadata: { retry: info },
    });
  }

  reset(): void {
    this.trace = null;
    this.stepSeq = 0;
  }
}

/**
 * Process-wide реестр активных trace по ключу (обычно sessionId).
 * Нужен, чтобы Context Builder (core-agent `before_agent_start`, в sub-session)
 * мог добавить «context» step в trace, созданный в orchestrator (runPrompt).
 * Один ключ = один активный trace (повторный register перезаписывает).
 */
const activeTraces = new Map<string, TraceManager>();

export function registerTrace(key: string, manager: TraceManager): void {
  activeTraces.set(key, manager);
}

export function getActiveTrace(key: string): TraceManager | undefined {
  return activeTraces.get(key);
}

export function unregisterTrace(key: string): void {
  activeTraces.delete(key);
}

let cachedVersion: string | null = null;

/**
 * Версия агента из СУЩЕСТВУЮЩЕГО механизма (см. Architecture Map §12):
 * `apps/agent/package.json#version`; override через `GRIHA_AGENT_VERSION`.
 * Вторую систему версий не создаём.
 */
export function getAgentVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  const env = process.env.GRIHA_AGENT_VERSION;
  if (env && env.trim()) {
    cachedVersion = env.trim();
    return cachedVersion;
  }
  try {
    const pkgUrl = new URL("../../../package.json", import.meta.url);
    const raw = JSON.parse(fs.readFileSync(fileURLToPath(pkgUrl), "utf8")) as {
      version?: unknown;
    };
    cachedVersion =
      typeof raw.version === "string" && raw.version ? raw.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}
