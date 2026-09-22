import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initObs, resetObsForTests } from "@griha/observability";
import type { ObsEvent, ObsSink } from "@griha/observability";
import { tryExtendBudgetWithObs } from "../../src/runtime/generation/allocator-obs.js";
import { resolveGenerationBudget } from "../../src/runtime/generation/policy.js";
import { createExtensionState } from "../../src/runtime/generation/allocator.js";

let captured: ObsEvent[] = [];
const sink: ObsSink = { write(e) { captured.push(e); } };

beforeEach(() => {
  // тест-скрипт ставит GRIHA_OBS=0; obs-тесты явно включают emit.
  delete process.env.GRIHA_OBS;
  resetObsForTests();
  captured = [];
});

afterEach(() => {
  resetObsForTests();
  captured = [];
});

test("tryExtendBudgetWithObs → generation.extend", () => {
  initObs({ sink });
  const budget = resolveGenerationBudget({ complexity: "trivial" }); // step 256, maxExt 1
  const state = createExtensionState(budget); // current = initial 256
  const d = tryExtendBudgetWithObs(budget, state, { correlationId: "c1" });
  assert.ok(d.ok);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].event, "generation.extend");
  assert.equal((captured[0].data as Record<string, unknown>).toMaxTokens, d.nextMaxTokens);
  assert.equal(captured[0].correlationId, "c1");
});

test("tryExtendBudgetWithObs → generation.extend_denied", () => {
  initObs({ sink });
  const budget = resolveGenerationBudget({ complexity: "trivial" });
  const state = { extensionsUsed: 0, currentMaxTokens: budget.hardMaxTokens };
  const d = tryExtendBudgetWithObs(budget, state, { correlationId: "c1" });
  assert.equal(d.ok, false);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].event, "generation.extend_denied");
  assert.equal((captured[0].data as Record<string, unknown>).reason, "already_at_hard");
});
