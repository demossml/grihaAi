import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallFlash } from "../../../.pi/extensions/telegram-bot/pool-call-flash.js";

const MSGS = [{ role: "user" as const, content: "hi" }];

test("mock fetch 200 + content → returns string", async () => {
  const callFlash = createCallFlash({
    apiKey: "k",
    fetchFn: async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "routed" } }] }),
        { status: 200 },
      ),
  });
  const result = await callFlash(MSGS);
  assert.equal(result, "routed");
});

test("mock fetch 500 → throws", async () => {
  const callFlash = createCallFlash({
    apiKey: "k",
    fetchFn: async () => new Response("boom", { status: 500 }),
  });
  await assert.rejects(() => callFlash(MSGS), /flash_http_500/);
});

test("empty content → throws flash_empty_content", async () => {
  const callFlash = createCallFlash({
    apiKey: "k",
    fetchFn: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
        status: 200,
      }),
  });
  await assert.rejects(() => callFlash(MSGS), /flash_empty_content/);
});
