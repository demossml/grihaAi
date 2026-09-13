/**
 * Item 16.2 (P2/§31): structured telemetry + correlation ID.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelemetryBuffer,
  generateCorrelationId,
  isValidCorrelationId,
} from "../../src/runtime/observability/telemetry.js";

describe("Telemetry (Item 16.2)", () => {
  it("correlation id: уникальный и валидный", () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    assert.ok(isValidCorrelationId(a));
    assert.ok(isValidCorrelationId(b));
    assert.notEqual(a, b);
  });

  it("isValidCorrelationId: мусор отклоняется", () => {
    assert.equal(isValidCorrelationId("bad id"), false);
    assert.equal(isValidCorrelationId("x"), false);
    assert.equal(isValidCorrelationId("a".repeat(65)), false);
  });

  it("startRun + record + getRun: события по run", () => {
    const buffer = new TelemetryBuffer();
    const id = buffer.startRun();
    buffer.record(id, { kind: "agent-run", atMs: 1 });
    buffer.record(id, { kind: "model-selected", atMs: 2, data: { role: "main" } });
    assert.equal(buffer.getRun(id)?.events.length, 2);
    assert.equal(buffer.getRun(id)?.correlationId, id);
  });

  it("record в неизвестный run → ошибка; дубликат startRun → ошибка", () => {
    const buffer = new TelemetryBuffer();
    assert.throws(() => buffer.record("ghost", { kind: "error", atMs: 1 }), /unknown correlation/);
    const id = buffer.startRun();
    assert.throws(() => buffer.startRun(id), /already started/);
  });

  it("countByKind: §31-метрики", () => {
    const buffer = new TelemetryBuffer();
    const id = buffer.startRun();
    buffer.record(id, { kind: "tokens", atMs: 1 });
    buffer.record(id, { kind: "tokens", atMs: 2 });
    buffer.record(id, { kind: "latency", atMs: 3 });
    const counts = buffer.countByKind(id);
    assert.equal(counts.get("tokens"), 2);
    assert.equal(counts.get("latency"), 1);
    assert.equal(counts.get("fallback"), undefined);
  });

  it("cap на число событий: старые вытесняются", () => {
    const buffer = new TelemetryBuffer({ maxEventsPerRun: 3 });
    const id = buffer.startRun();
    for (let i = 0; i < 5; i++) buffer.record(id, { kind: "tool-calls", atMs: i });
    assert.equal(buffer.getRun(id)?.events.length, 3);
    assert.equal(buffer.getRun(id)?.events[0].atMs, 2);
  });
});
