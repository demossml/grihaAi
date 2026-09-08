import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeDay, suggestAlternative } from "../../src/utils/focus-time.js";

describe("focus-time protection", () => {
  it("computes density and finds focus blocks", () => {
    // 09:00–10:00 and 14:00–15:00 busy → free gaps 10:00–14:00 (240min, focus),
    // 15:00–18:00 (180min, focus).
    const analysis = analyzeDay([
      { startMinutes: 9 * 60, endMinutes: 10 * 60, title: "A" },
      { startMinutes: 14 * 60, endMinutes: 15 * 60, title: "B" },
    ]);
    assert.equal(analysis.busyMinutes, 120);
    assert.equal(analysis.focusBlocks.length, 2);
    assert.equal(analysis.density, 120 / (9 * 60));
  });

  it("detects fragmented days", () => {
    // Meetings every 20 minutes → many short gaps.
    const blocks = [9, 10, 11, 12, 13].map((h) => ({
      startMinutes: h * 60,
      endMinutes: h * 60 + 45,
      title: `M${h}`,
    }));
    const analysis = analyzeDay(blocks);
    assert.ok(analysis.fragmentedGaps >= 4);
    assert.ok(analysis.density > 0.35);
  });

  it("suggests an alternative when a meeting splits a focus block", () => {
    const existing = [{ startMinutes: 9 * 60, endMinutes: 10 * 60, title: "A" }];
    const suggestion = suggestAlternative(
      existing,
      { startMinutes: 9 * 60 + 30, endMinutes: 10 * 60, title: "new" },
    );
    assert.equal(suggestion.conflicts, true);
    assert.ok(suggestion.alternativeStartMinutes !== undefined);
    assert.match(suggestion.message ?? "", /предложи/);
  });

  it("does not conflict when the day is free", () => {
    const suggestion = suggestAlternative(
      [],
      { startMinutes: 11 * 60, endMinutes: 12 * 60, title: "new" },
    );
    assert.equal(suggestion.conflicts, false);
  });
});
