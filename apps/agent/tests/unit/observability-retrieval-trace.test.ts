/**
 * Prompt 04 — RetrievalTrace: наблюдаемость retrieval/memory.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRetrievalTrace,
  hashQueryText,
  type RetrievalTrace,
} from "../../src/runtime/observability/retrieval-trace.js";
import { TraceManager } from "../../src/runtime/observability/trace.js";

describe("buildRetrievalTrace (Prompt 04)", () => {
  it("Retrieval step создаётся (step type = retrieval)", () => {
    const m = new TraceManager({ now: () => "2026-01-01T00:00:00.000Z" });
    m.start({ traceId: "t1", sessionId: "tg:1:2", agentVersion: "v1" });
    const step = m.addStep({
      type: "retrieval",
      status: "success",
      metadata: {
        retrieval: buildRetrievalTrace({
          queryId: "q1",
          queryType: "memory",
          candidatesCount: 3,
          selectedSourceIds: ["a", "b"],
          durationMs: 12,
        }),
      },
    });
    assert.equal(step.type, "retrieval");
    const r = step.metadata?.retrieval as RetrievalTrace;
    assert.equal(r.queryId, "q1");
    assert.equal(r.queryType, "memory");
  });

  it("empty retrieval фиксируется (candidatesCount = 0, selectedCount = 0)", () => {
    const r = buildRetrievalTrace({
      queryId: "q1",
      queryType: "memory",
      candidatesCount: 0,
      selectedSourceIds: [],
      durationMs: 5,
    });
    assert.equal(r.candidatesCount, 0);
    assert.equal(r.selectedCount, 0);
    assert.deepEqual(r.selectedSourceIds, []);
  });

  it("selectedCount vs candidatesCount корректны", () => {
    const r = buildRetrievalTrace({
      queryId: "q1",
      queryType: "memory",
      candidatesCount: 7,
      selectedSourceIds: ["a", "b", "c"],
      durationMs: 5,
    });
    assert.equal(r.candidatesCount, 7);
    assert.equal(r.selectedCount, 3);
  });

  it("связь с ContextTrace: selectedSourceIds = sourceId в context sources", () => {
    const r = buildRetrievalTrace({
      queryId: "q1",
      queryType: "memory",
      candidatesCount: 2,
      selectedSourceIds: ["mem-42"],
      durationMs: 5,
    });
    // Те же id появляются как sourceId в ContextSource (для связи retrieval→context).
    const contextSourceId = r.selectedSourceIds[0];
    assert.equal(contextSourceId, "mem-42");
  });

  it("сырые большие payloads не сохраняются (только hash, без queryText)", () => {
    const r = buildRetrievalTrace({
      queryId: "q1",
      queryType: "memory",
      queryText: "ОЧЕНЬ длинный секретный запрос пользователя, который не должен храниться",
      candidatesCount: 1,
      selectedSourceIds: ["a"],
      durationMs: 5,
    });
    assert.equal(typeof r.queryTextHash, "string");
    assert.equal(r.queryTextHash?.length, 16);
    assert.ok(!("queryText" in r), "сырой текст запроса не хранится");
  });
});

describe("hashQueryText (Prompt 04)", () => {
  it("детерминированный 16-hex хэш", () => {
    const h1 = hashQueryText("привет");
    const h2 = hashQueryText("привет");
    assert.equal(h1, h2);
    assert.equal(h1.length, 16);
    assert.match(h1, /^[0-9a-f]{16}$/);
  });

  it("разные тексты → разные хэши", () => {
    assert.notEqual(hashQueryText("a"), hashQueryText("b"));
  });
});
