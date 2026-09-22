import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emitTurnStart,
  emitTurnEnd,
  emitGenerationBudget,
  emitGenerationFinish,
} from "./helpers.js";
import { initObs, resetObsForTests } from "./obs.js";
import type { ObsEvent, ObsSink } from "./types.js";

let captured: ObsEvent[] = [];
const sink: ObsSink = { write(e) { captured.push(e); } };

afterEach(() => {
  resetObsForTests();
  captured = [];
  delete process.env.GRIHA_OBS;
});

describe("obs helpers (v2)", () => {
  it("emitTurnStart/End carry code + threadId + same correlationId", () => {
    resetObsForTests();
    initObs({ sink });
    emitTurnStart({ correlationId: "c1", chatId: "1", threadId: "t1", sessionKey: "s1" });
    emitTurnEnd({ correlationId: "c1", chatId: "1", ok: false, code: "timeout", durationMs: 12 });
    assert.equal(captured.length, 2);
    assert.equal(captured[0].event, "turn.start");
    assert.equal(captured[0].threadId, "t1");
    assert.equal(captured[1].event, "turn.end");
    assert.equal(captured[1].code, "timeout");
    assert.equal(captured[1].ok, false);
    assert.equal(captured[0].correlationId, captured[1].correlationId);
  });

  it("emitGenerationBudget/Finish carry code + data", () => {
    resetObsForTests();
    initObs({ sink });
    emitGenerationBudget({ correlationId: "c1", data: { complexity: "medium", initialMaxTokens: 1024 } });
    emitGenerationFinish({ correlationId: "c1", ok: true, code: "unknown", data: { usageAvailable: false } });
    assert.equal(captured[0].event, "generation.budget");
    assert.equal((captured[0].data as Record<string, unknown>).initialMaxTokens, 1024);
    assert.equal(captured[1].event, "generation.finish");
    assert.equal(captured[1].code, "unknown");
    assert.equal((captured[1].data as Record<string, unknown>).usageAvailable, false);
  });
});
