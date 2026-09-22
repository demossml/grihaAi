import { test } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import { isGenerationPolicyEnabled } from "../../../src/runtime/generation/flag.js";
import { ModelRouter } from "../../../src/utils/routing/model-router.js";

test("isGenerationPolicyEnabled() false by default", () => {
  assert.equal(isGenerationPolicyEnabled({}), false);
  assert.equal(isGenerationPolicyEnabled(), false);
  assert.equal(isGenerationPolicyEnabled({ GRIHA_GENERATION_POLICY: "1" }), true);
  assert.equal(isGenerationPolicyEnabled({ GRIHA_GENERATION_POLICY: "true" }), true);
  assert.equal(isGenerationPolicyEnabled({ GRIHA_GENERATION_POLICY: "0" }), false);
});

test("ModelRouter.getConfig main не бросает при флаге off", () => {
  const cfg = {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "x",
  } as GrishAiConfig;
  const router = new ModelRouter(cfg, undefined, {});
  const config = router.getConfig("main");
  assert.equal(config.model, "deepseek-v4-pro");
});
