import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFlashDecision,
  routeWithFlash,
} from "../../../src/runtime/routing/flash-route.js";

test("parseFlashDecision valid JSON", () => {
  const d = parseFlashDecision(
    '{"role":"main","complexity":"complex","kind":"analysis","confidence":0.9,"reason":"deep"}',
  );
  assert.ok(d);
  assert.equal(d.role, "main");
  assert.equal(d.source, "flash_llm");
  assert.equal(d.confidence, 0.9);
});

test("parseFlashDecision strips ```json fences", () => {
  const d = parseFlashDecision(
    '```json\n{"role":"flash","complexity":"trivial","kind":"chat_reply","confidence":0.8,"reason":"x"}\n```',
  );
  assert.ok(d);
  assert.equal(d.role, "flash");
});

test("parseFlashDecision invalid → null", () => {
  assert.equal(parseFlashDecision("not json"), null);
  assert.equal(
    parseFlashDecision('{"role":"bogus","complexity":"trivial"}'),
    null,
  );
});

test("routeWithFlash mock returns parsed decision", async () => {
  const d = await routeWithFlash(
    { userText: "hello" },
    {
      callFlash: async () =>
        JSON.stringify({
          role: "flash",
          complexity: "trivial",
          kind: "chat_reply",
          confidence: 0.9,
          reason: "ok",
        }),
    },
  );
  assert.equal(d.source, "flash_llm");
  assert.equal(d.role, "flash");
});

test("routeWithFlash throw → fallback / flash_error", async () => {
  const d = await routeWithFlash(
    { userText: "hello" },
    { callFlash: async () => { throw new Error("boom"); } },
  );
  assert.equal(d.source, "fallback");
  assert.equal(d.reason, "flash_error");
});
