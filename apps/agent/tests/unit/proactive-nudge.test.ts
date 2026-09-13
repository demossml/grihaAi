/**
 * Item 14.2 (N2): background nudge scheduling.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scheduleNudge } from "../../src/runtime/proactive/nudge.js";

// 2026-01-01T12:00:00Z — полдень UTC, час 12 (в окне 9–22)
const NOON_MS = Date.parse("2026-01-01T12:00:00Z");
// 2026-01-01T03:00:00Z — час 3 (вне окна)
const NIGHT_MS = Date.parse("2026-01-01T03:00:00Z");

describe("Nudge scheduling (Item 14.2)", () => {
  it("тишина больше порога + дневное время → nudge", () => {
    const decision = scheduleNudge(NOON_MS - 7 * 3600_000, NOON_MS, undefined);
    assert.equal(decision.nudge, true);
  });

  it("недавняя активность → нет nudge", () => {
    const decision = scheduleNudge(NOON_MS - 3600_000, NOON_MS, undefined);
    assert.equal(decision.nudge, false);
    assert.match(decision.reason, /недавняя/);
  });

  it("cooldown nudge не истёк → нет", () => {
    const decision = scheduleNudge(
      NOON_MS - 7 * 3600_000,
      NOON_MS,
      NOON_MS - 3600_000, // nudge час назад
    );
    assert.equal(decision.nudge, false);
    assert.match(decision.reason, /cooldown/);
  });

  it("вне разрешённых часов → нет", () => {
    const decision = scheduleNudge(NIGHT_MS - 7 * 3600_000, NIGHT_MS, undefined);
    assert.equal(decision.nudge, false);
    assert.match(decision.reason, /вне разрешённых часов/);
  });

  it("кастомная политика уважается", () => {
    const decision = scheduleNudge(
      NOON_MS - 3600_000,
      NOON_MS,
      undefined,
      { idleThresholdMs: 30 * 60_000, cooldownMs: 60_000, allowedHours: [0, 24] },
    );
    assert.equal(decision.nudge, true);
  });
});
