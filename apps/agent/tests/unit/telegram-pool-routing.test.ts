import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutingContext,
  preparePoolRouting,
} from "../../.pi/extensions/telegram-bot/pool-routing.js";

const NO_KEYWORDS =
  "просто длинное сообщение без ключевых слов о погоде и планах на выходные в ближайшее время";

describe("buildRoutingContext", () => {
  it("slice userText to 1500", () => {
    const long = "a".repeat(2000);
    const ctx = buildRoutingContext({ text: long });
    assert.equal(ctx.userText.length, 1500);
  });

  it("hasImage / hasVoice mapping", () => {
    assert.equal(buildRoutingContext({ text: "x", hasImage: true }).hasImage, true);
    assert.equal(buildRoutingContext({ text: "x" }).hasImage, false);
    assert.equal(buildRoutingContext({ text: "x", hasVoice: true }).hasVoice, true);
    assert.equal(buildRoutingContext({ text: "x" }).hasVoice, false);
  });

  it("chatType mapping", () => {
    for (const ct of ["private", "group", "supergroup", "channel"]) {
      assert.equal(buildRoutingContext({ text: "x", chatType: ct }).chatType, ct);
    }
    assert.equal(buildRoutingContext({ text: "x", chatType: "foo" }).chatType, "unknown");
    assert.equal(buildRoutingContext({ text: "x" }).chatType, "unknown");
  });
});

describe("preparePoolRouting", () => {
  it("flags OFF → no routing (null/null)", async () => {
    const r = await preparePoolRouting({ text: "привет" }, { env: {} });
    assert.deepEqual(r, { decision: null, budget: null });
  });

  it("policy on, flash off → decision + budget", async () => {
    const r = await preparePoolRouting(
      { text: "привет" },
      { env: { GRIHA_GENERATION_POLICY: "1" } },
    );
    assert.ok(r.decision);
    assert.ok(r.budget);
    assert.equal(r.decision.complexity, r.budget.complexity);
  });

  it("flash on + callFlash throws → fallback (fail-safe, no throw)", async () => {
    const r = await preparePoolRouting(
      { text: NO_KEYWORDS },
      {
        env: { GRIHA_FLASH_ROUTER: "1", GRIHA_GENERATION_POLICY: "1" },
        callFlash: async () => {
          throw new Error("boom");
        },
      },
    );
    assert.ok(r.decision);
    assert.equal(r.decision.source, "fallback");
    assert.equal(r.decision.reason, "flash_error");
  });

  it("flash on + mock callFlash analysis → role main", async () => {
    const r = await preparePoolRouting(
      { text: NO_KEYWORDS },
      {
        env: { GRIHA_FLASH_ROUTER: "1" },
        callFlash: async () =>
          JSON.stringify({
            role: "main",
            complexity: "complex",
            kind: "analysis",
            confidence: 0.9,
            reason: "deep",
          }),
      },
    );
    assert.ok(r.decision);
    assert.equal(r.decision.role, "main");
    assert.equal(r.decision.source, "flash_llm");
  });
});
