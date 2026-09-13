/**
 * Phase 16 (Item 16.2, матрица P2 + §31) — structured telemetry.
 *
 * §31: agent run, model selected, fallback, tokens, latency, tool calls,
 * memory retrieval, skill selected, delegation, compression, errors,
 * learning. Каждый run имеет correlation ID.
 */

export type TelemetryEventKind =
  | "agent-run"
  | "model-selected"
  | "fallback"
  | "tokens"
  | "latency"
  | "tool-calls"
  | "memory-retrieval"
  | "skill-selected"
  | "delegation"
  | "compression"
  | "error"
  | "learning";

export interface TelemetryEvent {
  kind: TelemetryEventKind;
  atMs: number;
  data?: Record<string, unknown>;
}

export interface RunTelemetry {
  correlationId: string;
  events: TelemetryEvent[];
}

const CORRELATION_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

let correlationSeq = 0;

/** Генерация correlation ID (каждый run — уникальный). */
export function generateCorrelationId(nowMs = Date.now()): string {
  correlationSeq += 1;
  return `run-${nowMs.toString(36)}-${correlationSeq.toString(36).padStart(4, "0")}`;
}

/** Валидация correlation ID (для приёмки внешних run). */
export function isValidCorrelationId(id: string): boolean {
  return CORRELATION_PATTERN.test(id);
}

/** In-memory буфер телеметрии по correlation ID, с cap на число событий. */
export class TelemetryBuffer {
  private readonly runs = new Map<string, RunTelemetry>();
  private readonly maxEventsPerRun: number;

  constructor(options: { maxEventsPerRun?: number } = {}) {
    this.maxEventsPerRun = options.maxEventsPerRun ?? 500;
  }

  startRun(correlationId?: string): string {
    const id = correlationId ?? generateCorrelationId();
    if (this.runs.has(id)) throw new Error(`run already started: ${id}`);
    this.runs.set(id, { correlationId: id, events: [] });
    return id;
  }

  record(correlationId: string, event: TelemetryEvent): void {
    const run = this.runs.get(correlationId);
    if (!run) throw new Error(`unknown correlation id: ${correlationId}`);
    run.events.push(event);
    if (run.events.length > this.maxEventsPerRun) {
      run.events.splice(0, run.events.length - this.maxEventsPerRun);
    }
  }

  getRun(correlationId: string): RunTelemetry | undefined {
    const run = this.runs.get(correlationId);
    return run ? { correlationId: run.correlationId, events: [...run.events] } : undefined;
  }

  /** Количество событий по kind (для метрик, §31). */
  countByKind(correlationId: string): Map<TelemetryEventKind, number> {
    const run = this.runs.get(correlationId);
    const counts = new Map<TelemetryEventKind, number>();
    for (const event of run?.events ?? []) {
      counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    }
    return counts;
  }

  /** Снимок всех runs (копии; порядок = порядок создания). */
  listRuns(): RunTelemetry[] {
    return [...this.runs.values()].map((run) => ({
      correlationId: run.correlationId,
      events: [...run.events],
    }));
  }

  /** Суммарные счётчики событий по kind по всем runs (для дашборда). */
  totalEventCounts(): Map<TelemetryEventKind, number> {
    const counts = new Map<TelemetryEventKind, number>();
    for (const run of this.runs.values()) {
      for (const event of run.events) {
        counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
      }
    }
    return counts;
  }
}
