import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProactiveGate,
} from "../../.pi/extensions/proactive-assistant/proactive-gate.js";
import { DEFAULT_PROACTIVE_POLICY } from "../../src/runtime/proactive/decision.js";

/**
 * W11 (матрица N2, §28) — event-gate для proactive за флагом.
 * Flag off → pass всегда (1:1). Flag on → §28 pipeline
 * (policy → relevance → security → decision), security выше proactive;
 * nudge: тишина + cooldown + часы.
 */

const ON = { HERMES_AGENT_RUNTIME: "1" };
const OFF = {};

const event = (context: string, action?: "send_message" | "financial", atMs = 1_000) => ({
  kind: "briefing" as const,
  action,
  context,
  atMs,
});

describe("ProactiveGate.evaluate (W11/N2)", () => {
  it("flag off: pass всегда (старое поведение)", () => {
    const gate = new ProactiveGate(OFF);
    const v = gate.evaluate(event("пусто"));
    assert.equal(v.pass, true);
    assert.equal(gate.active, false);
  });

  it("flag on: пустой контекст ниже порога → block", () => {
    const gate = new ProactiveGate(ON);
    const v = gate.evaluate(event("ничего важного"));
    assert.equal(v.pass, false);
    assert.match(v.reason, /relevance/);
  });

  it("flag on: дедлайн в контексте → pass", () => {
    const gate = new ProactiveGate(ON);
    const v = gate.evaluate(event("срочно: дедлайн по обязательству клиента"));
    assert.equal(v.pass, true);
    assert.ok(v.relevance >= 0.5);
  });

  it("flag on: аномалия → pass при пороге брифингов 0.35", () => {
    const gate = new ProactiveGate(ON, {
      ...DEFAULT_PROACTIVE_POLICY,
      relevanceThreshold: 0.35,
    });
    const v = gate.evaluate(event("аномалия: расходы превысили лимит на 40%"));
    assert.equal(v.pass, true);
  });

  it("flag on: security выше proactive — финансовое действие блокируется", () => {
    const gate = new ProactiveGate(ON);
    const v = gate.evaluate(
      event("срочно: дедлайн по обязательству перед клиентом", "financial"),
    );
    assert.equal(v.pass, false);
    assert.match(v.reason, /security выше proactive/);
  });

  it("cooldown: второе событие в пределах cooldown → block", () => {
    const gate = new ProactiveGate(ON, {
      ...DEFAULT_PROACTIVE_POLICY,
      cooldownMs: 60_000,
    });
    const first = gate.evaluate(
      event("срочно: дедлайн по обязательству перед клиентом", undefined, 1_000),
    );
    assert.equal(first.pass, true);
    const second = gate.evaluate(
      event("срочно: ещё один дедлайн перед клиентом", undefined, 2_000),
    );
    assert.equal(second.pass, false);
    assert.equal(second.reason, "cooldown");
  });

  it("тип не разрешён политикой → block", () => {
    const gate = new ProactiveGate(ON, {
      ...DEFAULT_PROACTIVE_POLICY,
      allowedKinds: ["calendar"],
    });
    const v = gate.evaluate(event("срочно: дедлайн"));
    assert.equal(v.pass, false);
    assert.match(v.reason, /не разрешён/);
  });
});

describe("ProactiveGate nudge (W11/N2)", () => {
  it("flag off: nudge не срабатывает", () => {
    const gate = new ProactiveGate(OFF);
    const d = gate.evaluateNudge(Date.now(), 0);
    assert.equal(d.nudge, false);
  });

  it("flag on: долгая тишина → nudge; pendingNudgeReason копится", () => {
    const gate = new ProactiveGate(ON, DEFAULT_PROACTIVE_POLICY, {
      idleThresholdMs: 1_000,
      cooldownMs: 1_000,
      allowedHours: [0, 24],
    });
    const now = new Date("2026-09-13T12:00:00Z").getTime();
    const d = gate.evaluateNudge(now, now - 2_000);
    assert.equal(d.nudge, true);
    assert.ok(gate.takePendingNudge());
    assert.equal(gate.takePendingNudge(), undefined);
  });

  it("cooldown nudge не истёк → без повтора", () => {
    const gate = new ProactiveGate(ON, DEFAULT_PROACTIVE_POLICY, {
      idleThresholdMs: 1_000,
      cooldownMs: 60_000,
      allowedHours: [0, 24],
    });
    const now = new Date("2026-09-13T12:00:00Z").getTime();
    assert.equal(gate.evaluateNudge(now, 0).nudge, true);
    const again = gate.evaluateNudge(now + 1_000, 0);
    assert.equal(again.nudge, false);
    assert.match(again.reason, /cooldown/);
  });

  it("вне разрешённых часов → без nudge", () => {
    const gate = new ProactiveGate(ON, DEFAULT_PROACTIVE_POLICY, {
      idleThresholdMs: 1_000,
      cooldownMs: 1_000,
      allowedHours: [9, 22],
    });
    const now = new Date("2026-09-13T03:00:00Z").getTime();
    const d = gate.evaluateNudge(now, 0);
    assert.equal(d.nudge, false);
    assert.match(d.reason, /вне разрешённых часов/);
  });
});
