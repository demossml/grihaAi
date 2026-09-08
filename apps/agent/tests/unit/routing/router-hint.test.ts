import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRouterHint,
  formatDelegationHint,
} from "../../../src/utils/routing/adaptive-router.js";
import type { DelegationPlan } from "../../../src/types/index.js";

describe("formatDelegationHint", () => {
  it("lists the plan tasks with roles and contexts", () => {
    const plan: DelegationPlan = {
      complexity: "complex",
      reason: "много частей",
      tasks: [
        { goal: "Сравнить отчёты", role: "analyst" },
        { goal: "Подготовить сводку", role: "writer", context: "для руководства" },
      ],
    };
    const hint = formatDelegationHint(plan);
    assert.match(hint, /COMPLEX/);
    assert.match(hint, /1\. \[analyst\] Сравнить отчёты/);
    assert.match(hint, /2\. \[writer\] Подготовить сводку/);
    assert.match(hint, /решение остаётся за тобой/);
  });
});

describe("buildRouterHint (pre-filter)", () => {
  it("returns null for SIMPLE and never calls the orchestrator", async () => {
    let llmCalled = false;
    const hint = await buildRouterHint("Забронируй встречу на завтра", async () => {
      llmCalled = true;
      return "{}";
    });
    assert.equal(hint, null);
    assert.equal(llmCalled, false);
  });

  it("returns a hint with a ready plan for COMPLEX", async () => {
    const hint = await buildRouterHint(
      "Сравни два отчёта и подготовь сводку, а также разошли её команде",
      async () =>
        JSON.stringify({
          tasks: [
            { goal: "Сравнить отчёты", role: "analyst" },
            { goal: "Разослать сводку", role: "scheduler" },
          ],
        }),
    );
    assert.ok(hint);
    assert.match(hint, /COMPLEX/);
    assert.match(hint, /Сравнить отчёты/);
    assert.match(hint, /Разослать сводку/);
  });
});
