/**
 * Prompt 08 — агрегация метрик + read-only Meta-hook + диагностический отчёт.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDiagnosticReport,
  computeMetrics,
  toEvaluationRecord,
  type AgentEvaluationRecord,
} from "../../src/runtime/observability/metrics.js";
import type { AgentTrace } from "../../src/runtime/observability/trace.js";
import { TraceStore } from "../../src/runtime/observability/trace-store.js";
import { TraceManager } from "../../src/runtime/observability/trace.js";

function makeTrace(partial: Partial<AgentTrace> & { traceId: string }): AgentTrace {
  return {
    sessionId: "tg:1:2",
    startedAt: "2026-01-01T00:00:00.000Z",
    agentVersion: "v1",
    status: "success",
    steps: [],
    retryCount: 0,
    ...partial,
  };
}

describe("computeMetrics (Prompt 08)", () => {
  it("агрегирует success/failure/retry/retrieval", () => {
    const traces: AgentTrace[] = [
      makeTrace({
        traceId: "t1",
        final: { success: true, taskOutcome: "completed" },
        steps: [
          { stepId: "t1.1", sequence: 1, type: "tool_call", startedAt: "2026-01-01T00:00:00.000Z", status: "success", metadata: { tool: { toolCallId: "c1", toolName: "memory_search", startedAt: "x", status: "success" } } },
          { stepId: "t1.2", sequence: 2, type: "retrieval", startedAt: "2026-01-01T00:00:00.000Z", status: "success", metadata: { retrieval: { queryId: "q1", queryType: "memory", candidatesCount: 2, selectedCount: 1, selectedSourceIds: ["a"], durationMs: 5 } } },
        ],
      }),
      makeTrace({
        traceId: "t2",
        final: { success: false, taskOutcome: "failed" },
        retryCount: 1,
        primaryFailure: { category: "execution", code: "TOOL_TIMEOUT" },
        steps: [
          { stepId: "t2.1", sequence: 1, type: "tool_call", startedAt: "2026-01-01T00:00:00.000Z", status: "failed", metadata: { tool: { toolCallId: "c2", toolName: "execute_code", startedAt: "x", status: "failed" } } },
        ],
      }),
      makeTrace({
        traceId: "t3",
        final: { success: true, taskOutcome: "needs_user_input" },
        steps: [],
      }),
    ];

    const m = computeMetrics(traces);
    assert.equal(m.totalTasks, 3);
    assert.ok(Math.abs(m.successRate - 1 / 3) < 1e-9);
    assert.ok(Math.abs(m.failureRate - 1 / 3) < 1e-9);
    assert.equal(m.unresolvedTasks, 1); // needs_user_input
    assert.ok(Math.abs(m.retryRate - 1 / 3) < 1e-9);
    assert.equal(m.toolTimeoutRate, 1 / 3);
    assert.equal(m.finalResponseFailures, 1);
    // 2 tool steps: 1 success, 1 failed
    assert.equal(m.toolSuccessRate, 0.5);
    assert.equal(m.toolFailureRate, 0.5);
    // 1 retrieval: hit
    assert.equal(m.retrievalHitRate, 1);
    assert.equal(m.emptyRetrievalRate, 0);
  });

  it("пустой список → нули без NaN", () => {
    const m = computeMetrics([]);
    assert.equal(m.totalTasks, 0);
    assert.equal(m.successRate, 0);
    assert.equal(m.avgDurationMs, 0);
    assert.equal(m.p95DurationMs, 0);
  });
});

describe("toEvaluationRecord (Prompt 08 read-only Meta-hook)", () => {
  it("проецирует trace в read-only запись (без секретов)", () => {
    const trace = makeTrace({
      traceId: "t1",
      taskType: "text",
      final: { success: true, taskOutcome: "completed", responseLength: 10 },
      retryCount: 1,
      steps: [
        { stepId: "t1.1", sequence: 1, type: "tool_call", startedAt: "x", status: "success", metadata: { tool: { toolCallId: "c1", toolName: "memory_search", startedAt: "x", status: "success" } } },
      ],
    });
    const rec: AgentEvaluationRecord = toEvaluationRecord(trace);
    assert.equal(rec.traceId, "t1");
    assert.equal(rec.sessionId, "tg:1:2");
    assert.equal(rec.agentVersion, "v1");
    assert.equal(rec.taskOutcome, "completed");
    assert.deepEqual(rec.toolNames, ["memory_search"]);
    assert.equal(rec.metrics?.retryCount, 1);
    // секретов в проекции нет: только id + имена + counts
    assert.ok(!JSON.stringify(rec).includes("secret"));
  });
});

describe("buildDiagnosticReport (Prompt 08)", () => {
  it("возвращает человекочитаемый отчёт", () => {
    const traces = [
      makeTrace({ traceId: "t1", final: { success: true, taskOutcome: "completed" } }),
      makeTrace({
        traceId: "t2",
        final: { success: false, taskOutcome: "failed" },
        primaryFailure: { category: "execution", code: "TOOL_TIMEOUT" },
      }),
    ];
    const report = buildDiagnosticReport(traces);
    assert.match(report, /total_tasks: 2/);
    assert.match(report, /success_rate: 50/);
    assert.match(report, /TOOL_TIMEOUT: 1/);
  });
});

describe("TraceStore.list (Prompt 08)", () => {
  it("list возвращает сохранённые trace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-metrics-"));
    const store = new TraceStore({ filePath: path.join(dir, "traces.sqlite") });
    try {
      const m = new TraceManager();
      m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
      const finished = m.finish("success", { success: true, taskOutcome: "completed" });
      store.save(finished);

      const list = store.list();
      assert.equal(list.length, 1);
      assert.equal(list[0].traceId, "t1");
      assert.equal(list[0].retryCount, 0);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
