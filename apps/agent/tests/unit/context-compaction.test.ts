/**
 * Item 3.2 (C2): shouldCompress — dual thresholds + cooldown + minTurns.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMPACTION_POLICY,
  shouldCompress,
  type UsageState,
} from "../../src/runtime/context/compaction.js";

const state = (usedTokens: number, turnCount = 10): UsageState => ({
  usedTokens,
  budgetTokens: 1000,
  turnCount,
});

describe("shouldCompress (Item 3.2)", () => {
  it("ниже агент-порога → none", () => {
    assert.equal(shouldCompress(state(300), 10_000, undefined).level, "none");
  });

  it("50% → agent, 85% → gateway (dual thresholds Griha)", () => {
    assert.equal(shouldCompress(state(500), 10_000, undefined).level, "agent");
    assert.equal(shouldCompress(state(850), 10_000, undefined).level, "gateway");
  });

  it("cooldown блокирует компакцию даже при gateway-уровне", () => {
    const d = shouldCompress(state(900), 10_000, 9_500);
    assert.equal(d.level, "none");
    assert.match(d.reason, /cooldown/);
  });

  it("cooldown истёк → gateway", () => {
    const d = shouldCompress(state(900), 70_000, 9_000); // 61_000ms ≥ 60_000ms
    assert.equal(d.level, "gateway");
  });

  it("minTurns: раньше 4 turns не компактируем", () => {
    const d = shouldCompress(state(900, 3), 10_000, undefined);
    assert.equal(d.level, "none");
    assert.match(d.reason, /minTurns/);
  });

  it("кастомная политика уважается", () => {
    const policy = { ...DEFAULT_COMPACTION_POLICY, agentRatioThreshold: 0.3 };
    assert.equal(shouldCompress(state(400), 10_000, undefined, policy).level, "agent");
  });

  it("нулевой бюджет → ratio 0, none", () => {
    const d = shouldCompress({ usedTokens: 100, budgetTokens: 0, turnCount: 10 }, 0, undefined);
    assert.equal(d.level, "none");
    assert.equal(d.ratio, 0);
  });

  it("ratio в решении соответствует used/budget", () => {
    const d = shouldCompress(state(600), 0, undefined);
    assert.equal(d.ratio, 0.6);
  });
});
