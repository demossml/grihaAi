import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGenerationBudget } from "../../../src/runtime/generation/policy.js";
import { applyRouteGuidance } from "../../../.pi/extensions/telegram-bot/pool-routing.js";
import { flashDepsFromConfig } from "../../../.pi/extensions/telegram-bot/pool-call-flash.js";
import type { GrishAiConfig } from "@griha/shared-types";

test("B: report_dispatch budget floor (trivial не режет до 128)", () => {
  const budget = resolveGenerationBudget({ complexity: "trivial", kind: "report_dispatch" });
  assert.ok(budget.initialMaxTokens >= 1024, `initial=${budget.initialMaxTokens}`);
  assert.ok(budget.softMaxTokens >= 2048, `soft=${budget.softMaxTokens}`);
  assert.ok(budget.hardMaxTokens >= 4096, `hard=${budget.hardMaxTokens}`);
  assert.ok(budget.initialMaxTokens <= budget.softMaxTokens);
  assert.ok(budget.softMaxTokens <= budget.hardMaxTokens);
});

test("B: report_dispatch floor работает для medium", () => {
  const budget = resolveGenerationBudget({ complexity: "medium", kind: "report_dispatch" });
  assert.ok(budget.initialMaxTokens >= 1024);
  assert.ok(budget.hardMaxTokens >= 4096);
});

test("B: обычный kind не форсирует floor", () => {
  const budget = resolveGenerationBudget({ complexity: "trivial", kind: "chat_reply" });
  assert.ok(budget.initialMaxTokens < 1024); // trivial chat_reply остаётся 256
});

test("C: guidance injects + idempotent (нет двойного inject)", () => {
  const out = applyRouteGuidance("привет", { kind: "report_dispatch" });
  assert.match(out, /report_data_expenses/);
  assert.match(out, /привет/);
  const twice = applyRouteGuidance(out, { kind: "report_dispatch" });
  assert.equal(twice, out);
});

test("C: guidance skips other kinds", () => {
  assert.equal(applyRouteGuidance("привет", { kind: "chat_reply" }), "привет");
});

test("A: flashDepsFromConfig → deepseek-v4-flash для deepseek", () => {
  const cfg = {
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    setupCompletedAt: "2026-01-01T00:00:00Z",
  } as GrishAiConfig;
  const deps = flashDepsFromConfig(cfg);
  assert.equal(deps.model, "deepseek-v4-flash");
});
