import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyExtension,
  createExtensionState,
  tryExtendBudget,
} from "../../../src/runtime/generation/allocator.js";
import { resolveGenerationBudget } from "../../../src/runtime/generation/policy.js";

test("createExtensionState current = initial", () => {
  const b = resolveGenerationBudget({ complexity: "medium" });
  const s = createExtensionState(b);
  assert.equal(s.currentMaxTokens, b.initialMaxTokens);
  assert.equal(s.extensionsUsed, 0);
});

test("tryExtend успех увеличивает на step", () => {
  const b = resolveGenerationBudget({ complexity: "medium" });
  const s = createExtensionState(b);
  const d = tryExtendBudget(b, s);
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.equal(d.nextMaxTokens, s.currentMaxTokens + b.extensionStepTokens);
  assert.equal(d.extensionsUsed, 1);
});

test("после maxExtensions → max_extensions", () => {
  const b = resolveGenerationBudget({ complexity: "trivial" }); // maxExtensions 1
  let s = createExtensionState(b);
  const d1 = tryExtendBudget(b, s);
  assert.equal(d1.ok, true);
  if (!d1.ok) return;
  s = applyExtension(s, d1);
  const d2 = tryExtendBudget(b, s);
  assert.equal(d2.ok, false);
  if (d2.ok) return;
  assert.equal(d2.reason, "max_extensions");
});

test("на hard → already_at_hard", () => {
  const b = resolveGenerationBudget({ complexity: "medium" });
  const s = { extensionsUsed: 0, currentMaxTokens: b.hardMaxTokens };
  const d = tryExtendBudget(b, s);
  assert.equal(d.ok, false);
  if (d.ok) return;
  assert.equal(d.reason, "already_at_hard");
});

test("applyExtension обновляет state", () => {
  const b = resolveGenerationBudget({ complexity: "medium" });
  const s = createExtensionState(b);
  const d = tryExtendBudget(b, s);
  assert.equal(d.ok, true);
  if (!d.ok) return;
  const next = applyExtension(s, d);
  assert.equal(next.currentMaxTokens, d.nextMaxTokens);
  assert.equal(next.extensionsUsed, 1);
});
