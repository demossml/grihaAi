/**
 * Item 7.4 (F4): quality score + regression.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillQualityTracker } from "../../src/runtime/learning/quality.js";

describe("Skill quality (Item 7.4)", () => {
  it("score: нет исходов → null", () => {
    const tracker = new SkillQualityTracker();
    assert.equal(tracker.score("calendar"), null);
    assert.equal(tracker.quality("calendar"), null);
  });

  it("score: все успехи → 1, все провалы → 0", () => {
    const tracker = new SkillQualityTracker();
    tracker.recordOutcome("s", true, 1);
    tracker.recordOutcome("s", true, 2);
    assert.equal(tracker.score("s"), 1);
    const bad = new SkillQualityTracker();
    bad.recordOutcome("s", false, 1);
    bad.recordOutcome("s", false, 2);
    assert.equal(bad.score("s"), 0);
  });

  it("недавние исходы весят больше (decay)", () => {
    const tracker = new SkillQualityTracker();
    tracker.recordOutcome("s", false, 1); // старый провал
    tracker.recordOutcome("s", true, 2); // свежий успех
    tracker.recordOutcome("s", true, 3);
    assert.ok((tracker.score("s") ?? 0) > 0.5);
  });

  it("regression: падение свежего окна относительно предыдущего", () => {
    const tracker = new SkillQualityTracker({ regressionWindow: 3, regressionDrop: 0.3 });
    // 6 старых успехов, 3 свежих провала
    for (let i = 0; i < 6; i++) tracker.recordOutcome("s", true, i);
    for (let i = 6; i < 9; i++) tracker.recordOutcome("s", false, i);
    assert.equal(tracker.regression("s"), true);
    const quality = tracker.quality("s");
    assert.equal(quality?.attempts, 9);
    assert.equal(quality?.regression, true);
  });

  it("regression: недостаточно данных → false", () => {
    const tracker = new SkillQualityTracker({ regressionWindow: 3 });
    tracker.recordOutcome("s", true, 1);
    tracker.recordOutcome("s", false, 2);
    assert.equal(tracker.regression("s"), false);
  });

  it("стабильные исходы не дают регрессию", () => {
    const tracker = new SkillQualityTracker({ regressionWindow: 2, regressionDrop: 0.3 });
    for (let i = 0; i < 8; i++) tracker.recordOutcome("s", i % 2 === 0, i);
    assert.equal(tracker.regression("s"), false);
  });
});
