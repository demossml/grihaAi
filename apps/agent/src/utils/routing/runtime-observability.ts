import {
  generateCorrelationId,
  TelemetryBuffer,
} from "../../runtime/observability/telemetry.js";
import {
  estimateCost,
  ModelUsageAccumulator,
  type TokenUsage,
} from "../../runtime/observability/usage.js";
import type { ObservabilitySnapshot } from "../../runtime/observability/dashboard.js";
import { estimateTokens } from "../../runtime/context/usage.js";

/**
 * W13 (матрица P2/P3, §31/§32) — подключение telemetry/cost-учёта к
 * runtime-вызовам за флагом. In-memory singleton; корреляционный ID на каждый
 * model-call (§31), тоталы по ролям для Model Router (§32).
 */

export interface RuntimeCallEndInput {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number;
}

export class RuntimeObservability {
  readonly buffer = new TelemetryBuffer();
  readonly usage = new ModelUsageAccumulator();

  /** Начало вызова: correlation ID + события agent-run/model-selected. */
  begin(role: string, modelName: string): { correlationId: string } {
    const correlationId = this.buffer.startRun();
    this.buffer.record(correlationId, {
      kind: "agent-run",
      atMs: Date.now(),
      data: { role, modelName },
    });
    this.buffer.record(correlationId, {
      kind: "model-selected",
      atMs: Date.now(),
      data: { role, modelName },
    });
    return { correlationId };
  }

  /** Успешное завершение: tokens/latency + аккумуляция стоимости по роли. */
  end(
    correlationId: string,
    role: string,
    modelName: string,
    input: RuntimeCallEndInput,
  ): void {
    this.buffer.record(correlationId, {
      kind: "tokens",
      atMs: Date.now(),
      data: { ...input },
    });
    this.buffer.record(correlationId, {
      kind: "latency",
      atMs: Date.now(),
      data: { durationMs: input.durationMs },
    });
    this.usage.record({
      sessionId: correlationId,
      modelRole: role,
      modelName,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedTokens: 0,
      reasoningTokens: 0,
      toolCalls: input.toolCalls,
    });
  }

  /** Ошибка вызова: событие error. */
  fail(correlationId: string, error: unknown): void {
    this.buffer.record(correlationId, {
      kind: "error",
      atMs: Date.now(),
      data: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  /** B3: переход fallback-цепочки (событие fallback). */
  fallback(
    correlationId: string,
    fromModel: string,
    toModel: string,
    error: unknown,
  ): void {
    this.buffer.record(correlationId, {
      kind: "fallback",
      atMs: Date.now(),
      data: {
        fromModel,
        toModel,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  /** G1: фоновый review хода (событие learning, §31). Возвращает correlationId. */
  backgroundReview(turnIndex: number, lessonCount: number): string {
    const correlationId = this.buffer.startRun();
    this.buffer.record(correlationId, {
      kind: "learning",
      atMs: Date.now(),
      data: { turnIndex, lessonCount },
    });
    return correlationId;
  }

  /** Оценка токенов входа по тексту сообщений (§8-оценка). */
  estimateInputTokens(messages: Array<{ role: string; content: string }>): number {
    let total = 0;
    for (const m of messages) {
      total += estimateTokens(m.role) + estimateTokens(m.content) + 4;
    }
    return total;
  }

  /** Тоталы по ролям с оценкой стоимости (§32, для Model Router). */
  totalsByRole(): Array<{
    modelRole: string;
    usage: TokenUsage;
    cost: number;
    calls: number;
  }> {
    return this.usage.totalsByRole();
  }

  /** O2/§31: снимок для дашборда (runs + события по kind + тоталы по ролям). */
  snapshot(): ObservabilitySnapshot {
    return {
      generatedAt: new Date().toISOString(),
      runs: this.buffer.listRuns(),
      eventCounts: Object.fromEntries(this.buffer.totalEventCounts()),
      roleTotals: this.usage.totalsByRole(),
    };
  }

  /** Оценка стоимости одного вызова. */
  static costOf(usage: TokenUsage): number {
    return estimateCost(usage);
  }
}

/** Singleton для wiring (как TelemetryBuffer in-memory). */
export const runtimeObservability = new RuntimeObservability();

export { generateCorrelationId };
