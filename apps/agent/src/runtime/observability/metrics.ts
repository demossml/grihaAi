/**
 * Prompt 08 — агрегация метрик из traces + read-only Meta-hook интерфейс.
 *
 * Агрегирует из persisted AgentTrace (SQLite), не создавая параллельную
 * отчётность. Meta-Harness получает ТОЛЬКО read-only проекцию.
 */
import type { AgentTrace, AgentTraceStatus } from "./trace.js";
import type { TaskOutcome } from "./task-outcome.js";
import type { PrimaryFailure } from "./error-taxonomy.js";
import type { ContextTrace } from "./context-trace.js";
import type { RetrievalTrace } from "./retrieval-trace.js";
import type { ToolTrace } from "./tool-trace.js";

export interface MetricsSummary {
  totalTasks: number;
  successRate: number;
  failureRate: number;
  toolSuccessRate: number;
  toolFailureRate: number;
  toolTimeoutRate: number;
  retryRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  avgContextTokens: number;
  retrievalHitRate: number;
  emptyRetrievalRate: number;
  validationErrorRate: number;
  finalResponseFailures: number;
  unresolvedTasks: number;
}

function durationMs(trace: AgentTrace): number | undefined {
  if (!trace.finishedAt) return undefined;
  const ms = Date.parse(trace.finishedAt) - Date.parse(trace.startedAt);
  return Number.isFinite(ms) ? ms : undefined;
}

function isToolStepType(type: string): boolean {
  return type === "tool_call" || type === "tool_result";
}

/** Read-only проекция trace для будущего Meta-Harness (не менять prod-код). */
export interface AgentEvaluationRecord {
  traceId: string;
  sessionId: string;
  agentVersion: string;
  taskType?: string;
  status: AgentTraceStatus;
  taskOutcome?: TaskOutcome;
  primaryFailure?: PrimaryFailure;
  toolNames: string[];
  metrics?: Readonly<Record<string, number>>;
}

export function toEvaluationRecord(trace: AgentTrace): AgentEvaluationRecord {
  const toolNames = trace.steps
    .filter((s) => isToolStepType(s.type))
    .map((s) => (s.metadata?.tool as ToolTrace | undefined)?.toolName)
    .filter((n): n is string => typeof n === "string");
  const duration = durationMs(trace);
  return {
    traceId: trace.traceId,
    sessionId: trace.sessionId,
    agentVersion: trace.agentVersion,
    taskType: trace.taskType,
    status: trace.status,
    taskOutcome: trace.final?.taskOutcome,
    primaryFailure: trace.primaryFailure,
    toolNames,
    metrics: {
      retryCount: trace.retryCount ?? 0,
      ...(duration !== undefined ? { durationMs: duration } : {}),
      ...(trace.final?.responseLength !== undefined
        ? { responseLength: trace.final.responseLength }
        : {}),
    },
  };
}

/** Детерминированная агрегация метрик по списку trace. */
export function computeMetrics(traces: AgentTrace[]): MetricsSummary {
  const total = traces.length;
  const outcomes = traces.map((t) => t.final?.taskOutcome ?? "unknown");

  const completed = outcomes.filter((o) => o === "completed").length;
  const failed = outcomes.filter((o) => o === "failed").length;
  const unresolved = outcomes.filter(
    (o) => o === "needs_user_input" || o === "blocked" || o === "unknown" || o === "partially_completed",
  ).length;

  const toolSteps = traces.flatMap((t) => t.steps.filter((s) => isToolStepType(s.type)));
  const toolSuccess = toolSteps.filter((s) => s.status === "success").length;
  const toolFailed = toolSteps.filter((s) => s.status === "failed").length;

  const toolTimeouts = traces.filter((t) => t.primaryFailure?.code === "TOOL_TIMEOUT").length;
  const retried = traces.filter((t) => (t.retryCount ?? 0) > 0).length;

  const durations = traces
    .map(durationMs)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);

  const contextTokens = traces
    .map((t) => {
      const step = t.steps.find((s) => s.type === "context");
      const ctx = step?.metadata?.context as ContextTrace | undefined;
      return ctx?.estimatedTokens;
    })
    .filter((n): n is number => typeof n === "number");

  const retrievalSteps = traces.flatMap((t) => t.steps.filter((s) => s.type === "retrieval"));
  const retrievalHits = retrievalSteps.filter((s) => {
    const r = s.metadata?.retrieval as RetrievalTrace | undefined;
    return (r?.selectedCount ?? 0) > 0;
  }).length;
  const emptyRetrievals = retrievalSteps.length - retrievalHits;

  const validationSteps = traces.flatMap((t) => t.steps.filter((s) => s.type === "validation"));
  const finalFailures = traces.filter((t) => t.final?.success === false).length;

  const avg = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

  const p95 = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const idx = Math.min(xs.length - 1, Math.floor(xs.length * 0.95));
    return xs[idx];
  };

  return {
    totalTasks: total,
    successRate: total === 0 ? 0 : completed / total,
    failureRate: total === 0 ? 0 : failed / total,
    toolSuccessRate: toolSteps.length === 0 ? 0 : toolSuccess / toolSteps.length,
    toolFailureRate: toolSteps.length === 0 ? 0 : toolFailed / toolSteps.length,
    toolTimeoutRate: total === 0 ? 0 : toolTimeouts / total,
    retryRate: total === 0 ? 0 : retried / total,
    avgDurationMs: Math.round(avg(durations)),
    p95DurationMs: Math.round(p95(durations)),
    avgContextTokens: Math.round(avg(contextTokens)),
    retrievalHitRate: retrievalSteps.length === 0 ? 0 : retrievalHits / retrievalSteps.length,
    emptyRetrievalRate: retrievalSteps.length === 0 ? 0 : emptyRetrievals / retrievalSteps.length,
    validationErrorRate: toolSteps.length === 0 ? 0 : validationSteps.length / toolSteps.length,
    finalResponseFailures: finalFailures,
    unresolvedTasks: unresolved,
  };
}

/** Человекочитаемый диагностический отчёт за период. */
export function buildDiagnosticReport(traces: AgentTrace[]): string {
  const m = computeMetrics(traces);

  const failureCategories = new Map<string, number>();
  const failingTools = new Map<string, number>();
  for (const t of traces) {
    const code = t.primaryFailure?.code;
    if (code) failureCategories.set(code, (failureCategories.get(code) ?? 0) + 1);
    for (const s of t.steps) {
      if (s.status !== "failed") continue;
      const name = (s.metadata?.tool as ToolTrace | undefined)?.toolName ?? s.metadata?.toolName;
      if (typeof name === "string") failingTools.set(name, (failingTools.get(name) ?? 0) + 1);
    }
  }

  const topCategories = [...failureCategories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, n]) => `${c}: ${n}`)
    .join(", ");
  const topTools = [...failingTools.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, n]) => `${t}: ${n}`)
    .join(", ");

  return [
    `total_tasks: ${m.totalTasks}`,
    `success_rate: ${(m.successRate * 100).toFixed(1)}%`,
    `failure_rate: ${(m.failureRate * 100).toFixed(1)}%`,
    `unresolved: ${m.unresolvedTasks}`,
    `avg_duration_ms: ${m.avgDurationMs}`,
    `p95_duration_ms: ${m.p95DurationMs}`,
    `retry_rate: ${(m.retryRate * 100).toFixed(1)}%`,
    `empty_retrieval_rate: ${(m.emptyRetrievalRate * 100).toFixed(1)}%`,
    `validation_errors: ${Math.round(m.validationErrorRate * 100)}%`,
    `top_failure_categories: ${topCategories || "-"}`,
    `most_failing_tools: ${topTools || "-"}`,
  ].join("\n");
}
