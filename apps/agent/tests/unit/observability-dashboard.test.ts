/**
 * O2 (матрица P3, §31/§32) — дашборд observability.
 * listRuns/eventCounts (TelemetryBuffer), snapshot (RuntimeObservability),
 * renderTelemetryDashboard (markdown, детерминированный).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelemetryBuffer } from "../../src/runtime/observability/telemetry.js";
import { ModelUsageAccumulator } from "../../src/runtime/observability/usage.js";
import {
  recentErrors,
  renderTelemetryDashboard,
  type ObservabilitySnapshot,
} from "../../src/runtime/observability/dashboard.js";
import { RuntimeObservability } from "../../src/utils/routing/runtime-observability.js";

describe("Observability dashboard (O2)", () => {
  it("listRuns возвращает копии (мутация снимка не трогает буфер)", () => {
    const buffer = new TelemetryBuffer();
    const id = buffer.startRun();
    buffer.record(id, { kind: "agent-run", atMs: 1 });
    const runs = buffer.listRuns();
    runs[0]!.events.push({ kind: "error", atMs: 2 });
    assert.equal(buffer.listRuns()[0]!.events.length, 1, "буфер не изменён");
  });

  it("totalEventCounts агрегирует по всем runs", () => {
    const buffer = new TelemetryBuffer();
    const a = buffer.startRun();
    const b = buffer.startRun();
    buffer.record(a, { kind: "agent-run", atMs: 1 });
    buffer.record(a, { kind: "fallback", atMs: 2 });
    buffer.record(b, { kind: "fallback", atMs: 3 });
    const counts = buffer.totalEventCounts();
    assert.equal(counts.get("agent-run"), 1);
    assert.equal(counts.get("fallback"), 2);
  });

  it("RuntimeObservability.snapshot: runs + eventCounts + roleTotals", () => {
    const obs = new RuntimeObservability();
    const call = obs.begin("main", "deepseek-v4-pro");
    obs.end(call.correlationId, "main", "deepseek-v4-pro", {
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: 2,
      durationMs: 10,
    });
    const snapshot = obs.snapshot();
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.eventCounts["agent-run"], 1);
    assert.equal(snapshot.eventCounts["tokens"], 1);
    assert.equal(snapshot.roleTotals.length, 1);
    assert.equal(snapshot.roleTotals[0]!.modelRole, "main");
    assert.equal(snapshot.roleTotals[0]!.calls, 1);
    assert.equal(snapshot.roleTotals[0]!.usage.inputTokens, 100);
  });

  it("renderTelemetryDashboard: пустой снимок → заголовки и '(нет …)'", () => {
    const snapshot: ObservabilitySnapshot = {
      generatedAt: "2026-09-13T00:00:00Z",
      runs: [],
      eventCounts: {},
      roleTotals: [],
    };
    const report = renderTelemetryDashboard(snapshot);
    assert.ok(report.includes("# Observability dashboard"));
    assert.ok(report.includes("runs: 0"));
    assert.ok(report.includes("(нет событий)"));
    assert.ok(report.includes("(нет вызовов)"));
    assert.ok(report.includes("(нет ошибок)"));
  });

  it("renderTelemetryDashboard: события, роли с токенами/стоимостью, ошибки", () => {
    const buffer = new TelemetryBuffer();
    const id = buffer.startRun();
    buffer.record(id, { kind: "agent-run", atMs: 1 });
    buffer.record(id, { kind: "fallback", atMs: 2 });
    buffer.record(id, { kind: "error", atMs: 3, data: { message: "429 provider" } });

    const usage = new ModelUsageAccumulator();
    usage.record({
      sessionId: id,
      modelRole: "main",
      modelName: "deepseek-v4-pro",
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 100,
      reasoningTokens: 0,
      toolCalls: 3,
    });

    const snapshot: ObservabilitySnapshot = {
      generatedAt: "2026-09-13T00:00:00Z",
      runs: buffer.listRuns(),
      eventCounts: Object.fromEntries(buffer.totalEventCounts()),
      roleTotals: usage.totalsByRole(),
    };
    const report = renderTelemetryDashboard(snapshot);
    assert.ok(report.includes("runs: 1"));
    assert.ok(report.includes("- agent-run: 1"));
    assert.ok(report.includes("- fallback: 1"));
    assert.ok(report.includes("- error: 1"));
    assert.ok(report.includes("main: 1 вызовов"));
    assert.ok(report.includes("in 1000 / out 200"));
    assert.ok(report.includes("429 provider"));
  });

  it("recentErrors: только ошибки, последние 5", () => {
    const buffer = new TelemetryBuffer();
    const id = buffer.startRun();
    for (let i = 0; i < 7; i++) {
      buffer.record(id, { kind: "agent-run", atMs: i });
      buffer.record(id, { kind: "error", atMs: i, data: { message: `err ${i}` } });
    }
    const errors = recentErrors({
      generatedAt: "",
      runs: buffer.listRuns(),
      eventCounts: {},
      roleTotals: [],
    });
    assert.equal(errors.length, 5);
    assert.deepEqual(errors.map((e) => e.message), ["err 2", "err 3", "err 4", "err 5", "err 6"]);
  });
});
