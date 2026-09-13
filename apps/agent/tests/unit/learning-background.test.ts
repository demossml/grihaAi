/**
 * Item 7.5 (G1): триггер background review.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldBackgroundReview } from "../../src/runtime/learning/background.js";

describe("Background review (Item 7.5)", () => {
  it("ошибка → немедленный review", () => {
    assert.equal(shouldBackgroundReview({ turnIndex: 1, usedTools: false, hadError: true }).review, true);
  });

  it("tool-вызов → review", () => {
    assert.equal(shouldBackgroundReview({ turnIndex: 1, usedTools: true, hadError: false }).review, true);
  });

  it("плановый review: каждый everyNTurns после minTurns", () => {
    const d = shouldBackgroundReview({ turnIndex: 10, usedTools: false, hadError: false });
    assert.equal(d.review, true);
    assert.match(d.reason, /плановый/);
    const early = shouldBackgroundReview({ turnIndex: 9, usedTools: false, hadError: false });
    assert.equal(early.review, false);
  });

  it("до minTurns планового review нет", () => {
    const d = shouldBackgroundReview({ turnIndex: 5, usedTools: false, hadError: false });
    assert.equal(d.review, false);
  });

  it("кастомная политика уважается", () => {
    const d = shouldBackgroundReview(
      { turnIndex: 6, usedTools: false, hadError: false },
      { everyNTurns: 3, minTurns: 6 },
    );
    assert.equal(d.review, true);
  });

  it("обычный turn без маркеров → нет review", () => {
    const d = shouldBackgroundReview({ turnIndex: 12, usedTools: false, hadError: false });
    assert.equal(d.review, false);
  });
});
