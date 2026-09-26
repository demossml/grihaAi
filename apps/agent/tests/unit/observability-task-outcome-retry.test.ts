/**
 * Prompt 07 — Retry observability, TaskOutcome, AgentVersion.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTaskOutcome } from "../../src/runtime/observability/task-outcome.js";
import { TraceManager, getAgentVersion } from "../../src/runtime/observability/trace.js";

const TS = "2026-01-01T00:00:00.000Z";

describe("computeTaskOutcome (Prompt 07)", () => {
  it("success → completed", () => {
    assert.equal(computeTaskOutcome({ ok: true, hadReply: true }), "completed");
  });
  it("failed → failed", () => {
    assert.equal(computeTaskOutcome({ ok: false }), "failed");
  });
  it("needs_user_input (approval) → needs_user_input", () => {
    assert.equal(
      computeTaskOutcome({ ok: true, hadReply: true, needsUserInput: true }),
      "needs_user_input",
    );
  });
  it("ok, но без ответа → unknown", () => {
    assert.equal(computeTaskOutcome({ ok: true, hadReply: false }), "unknown");
  });
});

describe("recordRetry (Prompt 07)", () => {
  it("retry виден в trace (step type=retry)", () => {
    const m = new TraceManager({ now: () => TS });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const step = m.recordRetry({ attempt: 1, kind: "fallback", from: "deepseek-v4-pro", to: "deepseek-v4-flash" });
    assert.equal(step.type, "retry");
    assert.equal(m.current?.steps.some((s) => s.type === "retry"), true);
  });

  it("retryCount корректно растёт", () => {
    const m = new TraceManager({ now: () => TS });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    assert.equal(m.current?.retryCount, 0);
    m.recordRetry({ attempt: 1, kind: "retry", reason: "timeout" });
    m.recordRetry({ attempt: 2, kind: "retry", reason: "timeout" });
    assert.equal(m.current?.retryCount, 2);
  });
});

describe("AgentVersion (Prompt 07)", () => {
  it("agentVersion присутствует и стабилен", () => {
    const v1 = getAgentVersion();
    const v2 = getAgentVersion();
    assert.equal(typeof v1, "string");
    assert.ok(v1.length > 0);
    assert.equal(v1, v2); // стабилен (кэш)
  });

  it("agentVersion пишется в каждый trace", () => {
    const m = new TraceManager({ now: () => TS });
    const t = m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: getAgentVersion() });
    assert.equal(t.agentVersion, getAgentVersion());
  });
});
