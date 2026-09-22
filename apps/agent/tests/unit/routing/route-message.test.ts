import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFlashRouterEnabled,
  routeMessage,
} from "../../../src/runtime/routing/route-message.js";

const NO_KEYWORDS = {
  userText:
    "просто длинное сообщение без ключевых слов о погоде и планах на выходные",
};

test("flag off + rule hit → source rule", async () => {
  const d = await routeMessage({ userText: "привет" }, { env: {} });
  assert.equal(d.source, "rule");
  assert.equal(d.role, "flash");
});

test("flag off + no rule → fallback", async () => {
  const d = await routeMessage(NO_KEYWORDS, { env: {} });
  assert.equal(d.source, "fallback");
  assert.equal(d.role, "main");
});

test("flag on + no rule + mock flash → flash_llm", async () => {
  const d = await routeMessage(NO_KEYWORDS, {
    env: { GRIHA_FLASH_ROUTER: "1" },
    callFlash: async () =>
      JSON.stringify({
        role: "main",
        complexity: "medium",
        kind: "chat_reply",
        confidence: 0.9,
        reason: "x",
      }),
  });
  assert.equal(d.source, "flash_llm");
});

test("isFlashRouterEnabled default false", () => {
  assert.equal(isFlashRouterEnabled(), false);
  assert.equal(isFlashRouterEnabled({ GRIHA_FLASH_ROUTER: "1" }), true);
  assert.equal(isFlashRouterEnabled({ GRIHA_FLASH_ROUTER: "true" }), true);
});
