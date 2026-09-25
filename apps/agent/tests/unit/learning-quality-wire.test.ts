/**
 * L2 — SkillQualityTracker.recordOutcome wiring (success/fail сигналы).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillQualityTracker } from "../../src/runtime/learning/quality.js";
import { recordSkillOutcomes } from "../../src/runtime/learning/quality-wire.js";

describe("recordSkillOutcomes (L2)", () => {
  it("success true → tracker отражает success count++", () => {
    const tracker = new SkillQualityTracker();
    const r = recordSkillOutcomes(tracker, ["s"], true, 1);
    assert.equal(r.recorded, 1);
    const q = tracker.quality("s");
    assert.equal(q?.attempts, 1);
    assert.equal(q?.successes, 1);
  });

  it("success false → failure count++", () => {
    const tracker = new SkillQualityTracker();
    recordSkillOutcomes(tracker, ["s"], false, 1);
    const q = tracker.quality("s");
    assert.equal(q?.attempts, 1);
    assert.equal(q?.successes, 0);
  });

  it("нет skillId → recordOutcome не вызывается / no throw", () => {
    const tracker = new SkillQualityTracker();
    const r = recordSkillOutcomes(tracker, [undefined, ""], true, 1);
    assert.equal(r.recorded, 0);
    assert.equal(tracker.quality("s"), null);
  });

  it("tracker throws → изолировано (helper возвращает, no throw)", () => {
    const broken = {
      recordOutcome: () => {
        throw new Error("boom");
      },
    } as unknown as SkillQualityTracker;
    const r = recordSkillOutcomes(broken, ["s"], true, 1);
    assert.equal(r.recorded, 0);
  });

  it("несколько skillId: один падает — остальные записываются", () => {
    const tracker = new SkillQualityTracker();
    const mixed = {
      recordOutcome: (skillId: string, success: boolean, atMs: number) => {
        if (skillId === "bad") throw new Error("boom");
        tracker.recordOutcome(skillId, success, atMs);
      },
    } as unknown as SkillQualityTracker;
    const r = recordSkillOutcomes(mixed, ["bad", "good"], true, 1);
    assert.equal(r.recorded, 1);
    assert.equal(tracker.quality("good")?.successes, 1);
    assert.equal(tracker.quality("bad"), null);
  });
});
