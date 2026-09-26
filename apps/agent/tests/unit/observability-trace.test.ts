/**
 * Prompt 02 — Core AgentTrace / AgentTraceStep + persistence + redaction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TraceManager,
  getAgentVersion,
} from "../../src/runtime/observability/trace.js";
import { TraceStore } from "../../src/runtime/observability/trace-store.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeManager(): TraceManager {
  return new TraceManager({ now: () => NOW });
}

describe("TraceManager (Prompt 02)", () => {
  it("create trace → running, пустые steps", () => {
    const m = makeManager();
    const t = m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    assert.equal(t.traceId, "t1");
    assert.equal(t.status, "running");
    assert.equal(t.steps.length, 0);
    assert.equal(t.startedAt, NOW);
  });

  it("append steps → sequence растёт, stepId уникален", () => {
    const m = makeManager();
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const s1 = m.addStep({ type: "input", status: "success" });
    const s2 = m.addStep({ type: "model", status: "started" });
    assert.equal(s1.sequence, 1);
    assert.equal(s2.sequence, 2);
    assert.equal(s1.stepId, "t1.1");
    assert.equal(s2.stepId, "t1.2");
    assert.equal(m.current?.steps.length, 2);
  });

  it("finish success → status success + final.success true", () => {
    const m = makeManager();
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const t = m.finish("success", { success: true, responseLength: 10 });
    assert.equal(t.status, "success");
    assert.equal(t.finishedAt, NOW);
    assert.equal(t.final?.success, true);
    assert.equal(t.final?.responseLength, 10);
  });

  it("finish failed → status failed + final.success false + errorCode", () => {
    const m = makeManager();
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const t = m.finish("failed", { success: false, errorCode: "prompt_error" });
    assert.equal(t.status, "failed");
    assert.equal(t.final?.success, false);
    assert.equal(t.final?.errorCode, "prompt_error");
  });

  it("sessionId сохраняется в существующем формате (tg:{userId}:{chatId})", () => {
    const m = makeManager();
    const t = m.start({ traceId: "t1", sessionId: "tg:5700958253:-5239797479", agentVersion: "v1" });
    assert.equal(t.sessionId, "tg:5700958253:-5239797479");
    // формат не меняется — это строка, переданная как есть
    assert.ok(t.sessionId.startsWith("tg:"));
  });

  it("agentVersion проставляется", () => {
    const m = makeManager();
    const t = m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "my-version" });
    assert.equal(t.agentVersion, "my-version");
  });

  it("redaction: чувствительные ключи не попадают в metadata", () => {
    const m = makeManager();
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const step = m.addStep({
      type: "model",
      status: "success",
      metadata: {
        apiKey: "sk-secret-123",
        token: "abc123",
        prompt: "visible text",
        tokens: 123,
      },
    });
    assert.equal(step.metadata?.apiKey, "[REDACTED]");
    assert.equal(step.metadata?.token, "[REDACTED]");
    assert.equal(step.metadata?.prompt, "visible text");
    assert.equal(step.metadata?.tokens, 123); // "tokens" (мн.ч.) НЕ redact
  });
});

describe("getAgentVersion (Prompt 02)", () => {
  it("возвращает непустую строку (package.json или env)", () => {
    const v = getAgentVersion();
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0);
  });
});

describe("TraceStore (Prompt 02 persistence)", () => {
  it("save/get roundtrip + sessionId/agentVersion/steps сохранены", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-db-"));
    const store = new TraceStore({
      filePath: path.join(dir, "traces.sqlite"),
      now: () => NOW,
    });
    try {
      // Реальный now: started_at должен быть свежим, иначе retention-prune
      // удалит trace сразу после save.
      const m = new TraceManager();
      m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
      m.addStep({ type: "input", status: "success", metadata: { textLen: 5 } });
      m.addStep({ type: "model", status: "started" });
      const finished = m.finish("success", { success: true, responseLength: 8 });
      store.save(finished);

      const loaded = store.get("t1");
      assert.ok(loaded);
      assert.equal(loaded.traceId, "t1");
      assert.equal(loaded.sessionId, "tg:1:2");
      assert.equal(loaded.agentVersion, "v1");
      assert.equal(loaded.status, "success");
      assert.equal(loaded.steps.length, 2);
      assert.equal(loaded.final?.success, true);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
