/**
 * Prompt 05 — ToolTrace + валидация результата tool.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolTrace,
  hashToolArgs,
  validateToolResult,
  type ToolTrace,
} from "../../src/runtime/observability/tool-trace.js";
import { TraceManager } from "../../src/runtime/observability/trace.js";

const TS = "2026-01-01T00:00:00.000Z";

describe("buildToolTrace (Prompt 05)", () => {
  it("tool success", () => {
    const t = buildToolTrace({
      toolCallId: "c1",
      toolName: "memory_search",
      startedAt: TS,
      status: "success",
    });
    assert.equal(t.status, "success");
    assert.equal(t.toolName, "memory_search");
  });

  it("tool failed (errorCode)", () => {
    const t = buildToolTrace({
      toolCallId: "c1",
      toolName: "execute_code",
      startedAt: TS,
      status: "failed",
      errorCode: "tool_error",
    });
    assert.equal(t.status, "failed");
    assert.equal(t.errorCode, "tool_error");
  });

  it("tool timeout", () => {
    const t = buildToolTrace({
      toolCallId: "c1",
      toolName: "delegate_tasks",
      startedAt: TS,
      status: "timeout",
    });
    assert.equal(t.status, "timeout");
  });

  it("retryCount сохраняется (в Griha ретраев тулов нет — поле forward-compatible)", () => {
    const t0 = buildToolTrace({ toolCallId: "c1", toolName: "x", startedAt: TS, status: "success" });
    const t2 = buildToolTrace({
      toolCallId: "c1",
      toolName: "x",
      startedAt: TS,
      status: "success",
      retryCount: 2,
    });
    assert.equal(t0.retryCount, undefined);
    assert.equal(t2.retryCount, 2);
  });

  it("секреты не попадают: args → hash, без сырых args", () => {
    const t = buildToolTrace({
      toolCallId: "c1",
      toolName: "x",
      args: { apiKey: "sk-secret-123", query: "секрет" },
      startedAt: TS,
      status: "success",
    });
    assert.equal(typeof t.argumentsHash, "string");
    assert.equal(t.argumentsHash?.length, 16);
    assert.ok(!("args" in t), "сырые args не хранятся");
  });
});

describe("hashToolArgs (Prompt 05)", () => {
  it("детерминированный хэш", () => {
    const h1 = hashToolArgs({ a: 1 });
    const h2 = hashToolArgs({ a: 1 });
    assert.equal(h1, h2);
    assert.equal(h1.length, 16);
  });

  it("несериализуемое → 'unserializable', не бросает", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(hashToolArgs(cyclic), "unserializable");
  });
});

describe("validateToolResult (Prompt 05)", () => {
  it("undefined/null → invalid empty_result", () => {
    assert.equal(validateToolResult(undefined).valid, false);
    assert.equal(validateToolResult(undefined).reason, "empty_result");
    assert.equal(validateToolResult(null).valid, false);
  });

  it("Error → invalid error_result", () => {
    const r = validateToolResult(new Error("boom"));
    assert.equal(r.valid, false);
    assert.equal(r.reason, "error_result");
  });

  it("ok:false → invalid explicit_failure", () => {
    const r = validateToolResult({ ok: false });
    assert.equal(r.valid, false);
    assert.equal(r.reason, "explicit_failure");
  });

  it("обычный объект → valid", () => {
    assert.equal(validateToolResult({ data: "x" }).valid, true);
  });
});

describe("ToolTrace + validation step в AgentTrace (Prompt 05)", () => {
  it("invalid result → validation step", () => {
    const m = new TraceManager({ now: () => TS });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    m.addStep({
      type: "tool_call",
      status: "success",
      metadata: { tool: buildToolTrace({ toolCallId: "c1", toolName: "x", startedAt: TS, status: "success" }) },
    });
    const validation = validateToolResult(undefined);
    const vStep = m.addStep({
      type: "validation",
      status: "failed",
      metadata: { toolName: "x", reason: validation.reason },
    });
    assert.equal(vStep.type, "validation");
    assert.equal(vStep.metadata?.reason, "empty_result");
    assert.equal(m.current?.steps.length, 2);
  });
});
