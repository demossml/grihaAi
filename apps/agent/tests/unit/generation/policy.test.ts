import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGenerationBudget } from "../../../src/runtime/generation/policy.js";
import { CODE_HARD_CAP_OUTPUT_TOKENS } from "../../../src/runtime/generation/profiles.js";

test("resolveGenerationBudget trivial → числа профиля (kind default other)", () => {
  const b = resolveGenerationBudget({ complexity: "trivial" });
  assert.equal(b.initialMaxTokens, 256);
  assert.equal(b.softMaxTokens, 512);
  assert.equal(b.hardMaxTokens, 1024);
  assert.equal(b.temperature, 0.2);
  assert.equal(b.kind, "other");
});

test("modelMaxTokens 1000 режет hard/soft/initial <= 1000", () => {
  const b = resolveGenerationBudget({ complexity: "medium", modelMaxTokens: 1000 });
  assert.ok(b.hardMaxTokens <= 1000);
  assert.ok(b.softMaxTokens <= b.hardMaxTokens);
  assert.ok(b.initialMaxTokens <= b.softMaxTokens);
});

test("configOverride hardMaxTokens 99999 → clamp к CODE_HARD_CAP", () => {
  const b = resolveGenerationBudget({
    complexity: "medium",
    configOverride: { hardMaxTokens: 99999 },
  });
  assert.equal(b.hardMaxTokens, CODE_HARD_CAP_OUTPUT_TOKENS);
});

test("kind analysis увеличивает initial vs other (medium), но <= soft", () => {
  const analysis = resolveGenerationBudget({ complexity: "medium", kind: "analysis" });
  const other = resolveGenerationBudget({ complexity: "medium", kind: "other" });
  assert.ok(analysis.initialMaxTokens > other.initialMaxTokens);
  assert.ok(analysis.initialMaxTokens <= analysis.softMaxTokens);
});

test("kind report_dispatch получает floor (initial/soft/hard не ниже минимума)", () => {
  const report = resolveGenerationBudget({ complexity: "medium", kind: "report_dispatch" });
  assert.ok(report.initialMaxTokens >= 1024);
  assert.ok(report.softMaxTokens >= 2048);
  assert.ok(report.hardMaxTokens >= 4096);
  assert.ok(report.initialMaxTokens <= report.softMaxTokens);
  assert.ok(report.softMaxTokens <= report.hardMaxTokens);
});
