import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { emit, initObs, newSpanId, resetObsForTests, withSpan } from "./index.js";
import type { ObsEvent, ObsSink } from "./index.js";

let captured: ObsEvent[] = [];
const sink: ObsSink = { write(e) { captured.push(e); } };

beforeEach(() => {
  delete process.env.GRIHA_OBS;
  resetObsForTests();
  captured = [];
});
afterEach(() => {
  resetObsForTests();
});

describe("withSpan (P0 spans)", () => {
  it("success → span.start + span.end ok:true", async () => {
    initObs({ sink });
    const r = await withSpan({ correlationId: "c1", span: "agent.prompt" }, async () => 42);
    assert.equal(r, 42);
    const starts = captured.filter((e) => e.event === "span.start");
    const ends = captured.filter((e) => e.event === "span.end");
    assert.equal(starts.length, 1);
    assert.equal(ends.length, 1);
    assert.equal((ends[0].data as Record<string, unknown>).span, "agent.prompt");
    assert.equal(ends[0].ok, true);
    assert.equal(typeof ends[0].durationMs, "number");
  });

  it("throw → span.end ok:false + rethrows", async () => {
    initObs({ sink });
    await assert.rejects(
      () =>
        withSpan({ correlationId: "c1", span: "x" }, async () => {
          throw new Error("boom");
        }),
      /boom/,
    );
    const ends = captured.filter((e) => e.event === "span.end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].ok, false);
    assert.equal(ends[0].code, "Error");
  });

  it("newSpanId содержит correlationId + span", () => {
    const id = newSpanId("c1", "agent.prompt");
    assert.ok(id.startsWith("c1:agent.prompt:"), id);
  });
});

describe("redact regression (token counters)", () => {
  it("maxTokens/initialMaxTokens/inputTokens НЕ redact-ятся", () => {
    initObs({ sink });
    emit({
      component: "t",
      event: "x",
      data: { maxTokens: 1024, initialMaxTokens: 2048, inputTokens: 10, totalTokens: 11 },
    });
    const d = captured[0].data as Record<string, unknown>;
    assert.equal(d.maxTokens, 1024);
    assert.equal(d.initialMaxTokens, 2048);
    assert.equal(d.inputTokens, 10);
    assert.equal(d.totalTokens, 11);
  });
});
