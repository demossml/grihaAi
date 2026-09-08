import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRealSubAgentRunner } from "../../.pi/extensions/multi-agent/RealSubAgentRunner.js";
import { loadConfig } from "@griha/config";

/**
 * Optional integration test on the real SDK-backed runner. Skipped by default
 * because it performs a real LLM call (requires a configured provider + API
 * key). Run explicitly with:
 *
 *   RUN_REAL_RUNNER=1 npx tsx --test tests/unit/real-subagent-runner.integration.test.ts
 */
const RUN = process.env.RUN_REAL_RUNNER === "1";

describe("real sub-agent runner (integration)", { skip: !RUN }, () => {
  it("runs a sub-agent through a real isolated AgentSession", async () => {
    const cfg = loadConfig();
    if (!cfg) {
      assert.fail("No grish-ai config found — run /setup first (or set GRISH_AI_HOME).");
    }

    const runner = createRealSubAgentRunner();
    const controller = new AbortController();
    const result = await runner({
      goal: "Ответь одним словом: готов.",
      role: "general",
      subtreeSessionId: "integration-test",
      signal: controller.signal,
    });

    assert.ok(result.result.trim().length > 0);
  });
});
