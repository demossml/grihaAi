/**
 * Item 8.2 (H3/§18/§19): orchestrator-контракт и синтез.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  synthesize,
  validatePlan,
  verifyPlanSecurity,
  type DelegationPlan,
  type WorkerResult,
} from "../../src/runtime/delegation/orchestrator.js";

const plan: DelegationPlan = {
  parentTask: "Собрать отчёт",
  steps: [
    { id: "s1", task: "запрос данных", toolsets: ["sqlite"] },
    { id: "s2", task: "форматирование", toolsets: ["csv"] },
  ],
  requiresAllSteps: true,
};

const result = (stepId: string, summary: string, ok = true): WorkerResult => ({
  stepId,
  workerId: `w-${stepId}`,
  summary,
  ok,
});

describe("Orchestrator (Item 8.2)", () => {
  it("полный набор результатов → ok synthesis из structured summaries", () => {
    const out = synthesize(plan, [result("s1", "данные готовы"), result("s2", "CSV собран")]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.missingStepIds, []);
    assert.match(out.synthesis, /\[s1\] данные готовы/);
    assert.match(out.synthesis, /\[s2\] CSV собран/);
  });

  it("пропущенный шаг → ok=false, synthesis пуст, missing перечислен", () => {
    const out = synthesize(plan, [result("s1", "данные готовы")]);
    assert.equal(out.ok, false);
    assert.deepEqual(out.missingStepIds, ["s2"]);
    assert.equal(out.synthesis, "");
  });

  it("упавший worker: part помечается FAILED, synthesis всё равно собирается", () => {
    const out = synthesize(plan, [
      result("s1", "данные готовы"),
      { stepId: "s2", workerId: "w-s2", summary: "", ok: false, error: "timeout" },
    ]);
    assert.equal(out.ok, true);
    assert.match(out.parts.find((p) => p.stepId === "s2")?.summary ?? "", /FAILED: timeout/);
  });

  it("§19: planner не может обходить security policy", () => {
    const bypass: DelegationPlan = {
      parentTask: "t",
      steps: [{ id: "x", task: "сделать опасное", toolsets: [], requiresSecurityBypass: true }],
      requiresAllSteps: true,
    };
    assert.deepEqual(verifyPlanSecurity(bypass), ["x"]);
    const out = synthesize(bypass, [result("x", "done")]);
    assert.equal(out.ok, false);
    assert.deepEqual(out.rejectedStepIds, ["x"]);
  });

  it("validatePlan: дубликаты stepId", () => {
    const dup: DelegationPlan = {
      parentTask: "t",
      steps: [
        { id: "a", task: "1", toolsets: [] },
        { id: "a", task: "2", toolsets: [] },
      ],
      requiresAllSteps: true,
    };
    assert.deepEqual(validatePlan(dup), ["duplicate stepId: a"]);
    assert.deepEqual(validatePlan(plan), []);
  });
});
