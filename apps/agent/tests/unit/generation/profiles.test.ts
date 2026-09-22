import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_HARD_CAP_OUTPUT_TOKENS,
  GENERATION_POLICY_VERSION,
  PROFILES,
} from "../../../src/runtime/generation/profiles.js";

test("каждый complexity: initial <= soft <= hard", () => {
  for (const [complexity, p] of Object.entries(PROFILES)) {
    assert.ok(
      p.initialMaxTokens <= p.softMaxTokens &&
        p.softMaxTokens <= p.hardMaxTokens,
      `${complexity}: инвариант нарушен`,
    );
  }
});

test("hard <= CODE_HARD_CAP_OUTPUT_TOKENS", () => {
  for (const [complexity, p] of Object.entries(PROFILES)) {
    assert.ok(p.hardMaxTokens <= CODE_HARD_CAP_OUTPUT_TOKENS, `${complexity}: hard выше cap`);
  }
});

test("GENERATION_POLICY_VERSION non-empty", () => {
  assert.ok(GENERATION_POLICY_VERSION.length > 0);
});
