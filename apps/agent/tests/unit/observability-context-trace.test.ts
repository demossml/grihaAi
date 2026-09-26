/**
 * Prompt 03 — ContextTrace: происхождение контекста перед моделью.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContextTrace,
  type ContextSource,
  type ContextTrace,
} from "../../src/runtime/observability/context-trace.js";
import { TraceManager } from "../../src/runtime/observability/trace.js";

describe("buildContextTrace (Prompt 03)", () => {
  it("ContextTrace создаётся при обычном запуске", () => {
    const ct = buildContextTrace([
      { sourceType: "message", selected: true, reason: "recent message" },
      { sourceType: "system", selected: true, reason: "system instruction" },
    ]);
    assert.equal(ct.sources.length, 2);
    assert.equal(ct.truncated, undefined);
  });

  it("selected / not selected источники отличаются", () => {
    const sources: ContextSource[] = [
      { sourceType: "memory", sourceId: "mem-1", selected: true, reason: "semantic relevance" },
      { sourceType: "memory", sourceId: "mem-2", selected: false, reason: "outside retrieval window" },
    ];
    const ct = buildContextTrace(sources);
    assert.equal(ct.sources[0].selected, true);
    assert.equal(ct.sources[1].selected, false);
    assert.equal(ct.sources[1].reason, "outside retrieval window");
  });

  it("truncation фиксируется", () => {
    const ct = buildContextTrace([], {
      truncated: true,
      truncationReason: "token budget exceeded",
    });
    assert.equal(ct.truncated, true);
    assert.equal(ct.truncationReason, "token budget exceeded");
  });

  it("sourceId присутствует там, где возможно", () => {
    const ct = buildContextTrace([
      { sourceType: "file", sourceId: "file-42", selected: true, reason: "semantic relevance" },
    ]);
    assert.equal(ct.sources[0].sourceId, "file-42");
  });

  it("полные тексты файлов в trace не попадают (только sourceId, без content)", () => {
    const ct = buildContextTrace([
      { sourceType: "file", sourceId: "file-42", selected: true, reason: "semantic relevance" },
    ]);
    const s = ct.sources[0];
    assert.ok(!("content" in s), "ContextSource не хранит содержимое");
    assert.ok(!("text" in s), "ContextSource не хранит текст");
  });
});

describe("ContextTrace в AgentTrace step (Prompt 03)", () => {
  it("context step хранит ContextTrace в metadata (без утечки содержимого)", () => {
    const m = new TraceManager({ now: () => "2026-01-01T00:00:00.000Z" });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const context: ContextTrace = {
      sources: [{ sourceType: "file", sourceId: "file-42", selected: true, reason: "semantic relevance" }],
    };
    const step = m.addStep({ type: "context", status: "success", metadata: { context } });

    assert.equal(step.type, "context");
    const stored = step.metadata?.context as ContextTrace;
    assert.equal(stored.sources[0].sourceType, "file");
    assert.equal(stored.sources[0].sourceId, "file-42");
  });

  it("context step redact-ит чувствительные ключи в metadata", () => {
    const m = new TraceManager({ now: () => "2026-01-01T00:00:00.000Z" });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const step = m.addStep({
      type: "context",
      status: "success",
      metadata: { context: { sources: [] }, apiKey: "sk-secret" },
    });
    assert.equal(step.metadata?.apiKey, "[REDACTED]");
    const stored = step.metadata?.context as ContextTrace;
    assert.deepEqual(stored.sources, []);
  });
});
