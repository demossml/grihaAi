/**
 * Item 14.1 (N2/§28): proactive decision pipeline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideProactive,
  evaluateRelevance,
} from "../../src/runtime/proactive/decision.js";

describe("Proactive decision (Item 14.1)", () => {
  it("релевантное событие без действия → act", () => {
    const decision = decideProactive(
      { kind: "anomaly", context: "Аномалия в расходах: срочно", atMs: 1_000 },
      undefined,
    );
    assert.equal(decision.act, true);
  });

  it("тип вне политики → отказ", () => {
    const decision = decideProactive(
      { kind: "self-improvement", context: "важно обновить скиллы", atMs: 1_000 },
      undefined,
    );
    assert.equal(decision.act, false);
    assert.match(decision.reason, /не разрешён/);
  });

  it("низкая релевантность → отказ", () => {
    const decision = decideProactive(
      { kind: "nudge", context: "ок", atMs: 1_000 },
      undefined,
    );
    assert.equal(decision.act, false);
    assert.match(decision.reason, /relevance/);
  });

  it("cooldown блокирует", () => {
    const decision = decideProactive(
      { kind: "anomaly", context: "срочно аномалия", atMs: 10_000 },
      9_500,
    );
    assert.equal(decision.act, false);
    assert.match(decision.reason, /cooldown/);
  });

  it("§28: security выше proactive — критическое действие требует approval", () => {
    const decision = decideProactive(
      { kind: "anomaly", context: "срочно! критическая аномалия", action: "system_modification", atMs: 1_000 },
      undefined,
    );
    assert.equal(decision.act, false);
    assert.match(decision.reason, /security выше proactive/);
  });

  it("средний риск в пределах maxAutonomousRisk → act", () => {
    const decision = decideProactive(
      { kind: "briefing", context: "важно: встреча завтра", action: "send_message", atMs: 1_000 },
      undefined,
    );
    assert.equal(decision.act, true);
  });

  it("evaluateRelevance: маркеры повышают score, пустой контекст ≈ 0", () => {
    assert.equal(evaluateRelevance({ kind: "nudge", context: "ок", atMs: 0 }), 0);
    const high = evaluateRelevance({ kind: "anomaly", context: "СРОЧНО: аномалия и дедлайн", atMs: 0 });
    assert.ok(high >= 0.7);
  });
});
