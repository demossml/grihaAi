/**
 * Phase 16 (матрица P3, §31) — дашборд observability.
 *
 * Чистый рендер снимка телеметрии в markdown: runs, события по kind,
 * тоталы по ролям (tokens/cost/calls, §32), свежие ошибки.
 * Снимок берётся из `RuntimeObservability.snapshot()` (in-memory singleton).
 */
import type { RunTelemetry, TelemetryEventKind } from "./telemetry.js";
import type { TokenUsage } from "./usage.js";

export interface RoleTotal {
  modelRole: string;
  usage: TokenUsage;
  cost: number;
  calls: number;
}

export interface ObservabilitySnapshot {
  generatedAt: string;
  runs: RunTelemetry[];
  eventCounts: Partial<Record<TelemetryEventKind, number>>;
  roleTotals: RoleTotal[];
}

const MAX_ERRORS = 5;

/** Свежие ошибки по всем runs (последние MAX_ERRORS, новые в конце). */
export function recentErrors(snapshot: ObservabilitySnapshot): Array<{
  correlationId: string;
  message: string;
}> {
  const errors: Array<{ correlationId: string; message: string }> = [];
  for (const run of snapshot.runs) {
    for (const event of run.events) {
      if (event.kind !== "error") continue;
      const data = event.data as { message?: unknown } | undefined;
      errors.push({
        correlationId: run.correlationId,
        message: typeof data?.message === "string" ? data.message : String(data?.message ?? "error"),
      });
    }
  }
  return errors.slice(-MAX_ERRORS);
}

/** Markdown-дашборд телеметрии (детерминированный вывод). */
export function renderTelemetryDashboard(snapshot: ObservabilitySnapshot): string {
  const lines: string[] = [
    "# Observability dashboard",
    `generatedAt: ${snapshot.generatedAt}`,
    `runs: ${snapshot.runs.length}`,
    "",
    "## Events by kind",
  ];
  const kinds = Object.entries(snapshot.eventCounts).sort(([a], [b]) => a.localeCompare(b));
  if (kinds.length === 0) {
    lines.push("- (нет событий)");
  } else {
    for (const [kind, count] of kinds) lines.push(`- ${kind}: ${count}`);
  }
  lines.push("", "## Models by role");
  if (snapshot.roleTotals.length === 0) {
    lines.push("- (нет вызовов)");
  } else {
    for (const t of snapshot.roleTotals) {
      lines.push(
        `- ${t.modelRole}: ${t.calls} вызовов, in ${t.usage.inputTokens} / out ${t.usage.outputTokens} / cached ${t.usage.cachedTokens} / reasoning ${t.usage.reasoningTokens} токенов, ~$${t.cost.toFixed(4)}`,
      );
    }
  }
  lines.push("", "## Recent errors");
  const errors = recentErrors(snapshot);
  if (errors.length === 0) {
    lines.push("- (нет ошибок)");
  } else {
    for (const e of errors) lines.push(`- [${e.correlationId}] ${e.message}`);
  }
  return lines.join("\n");
}
