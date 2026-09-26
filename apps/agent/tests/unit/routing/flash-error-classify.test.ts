/**
 * Flash_error: классификация причины + дешёвый fallback (не main/medium).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFlashError,
  routeWithFlash,
} from "../../../src/runtime/routing/flash-route.js";

describe("classifyFlashError", () => {
  it("AbortError → timeout", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    assert.equal(classifyFlashError(err).code, "timeout");
  });

  it("401 → http_401", () => {
    assert.equal(classifyFlashError(new Error("flash_http_401:unauthorized")).code, "http_401");
  });

  it("429 → http_4xx", () => {
    assert.equal(classifyFlashError(new Error("flash_http_429:rate limit")).code, "http_4xx");
  });

  it("500 → http_5xx", () => {
    assert.equal(classifyFlashError(new Error("flash_http_500:boom")).code, "http_5xx");
  });

  it("пустой контент → empty", () => {
    assert.equal(classifyFlashError(new Error("flash_empty_content")).code, "empty");
  });

  it("network → network", () => {
    assert.equal(classifyFlashError(new Error("fetch failed")).code, "network");
  });

  it("bad json → parse", () => {
    assert.equal(classifyFlashError(new Error("Unexpected token < in JSON")).code, "parse");
  });

  it("no api key → no_api_key", () => {
    assert.equal(classifyFlashError(new Error("missing api key")).code, "no_api_key");
  });

  it("прочее → unknown", () => {
    assert.equal(classifyFlashError(new Error("что-то")).code, "unknown");
  });
});

describe("routeWithFlash: дешёвый fallback при flash_error", () => {
  it("короткий текст + flash_error → complexity trivial (не medium)", async () => {
    const d = await routeWithFlash(
      { userText: "ок" },
      { callFlash: async () => { throw new Error("flash_http_401:x"); } },
    );
    assert.equal(d.complexity, "trivial");
    assert.equal(d.kind, "chat_reply");
    assert.equal(d.reason, "flash_error");
    assert.equal(d.flashErrorCode, "http_401");
  });

  it("flash_error несёт flashErrorMessage (truncate 200, без ключей)", async () => {
    const long = "x".repeat(500);
    const d = await routeWithFlash(
      { userText: "длинный вопрос без ключей" },
      { callFlash: async () => { throw new Error(`flash_http_500:${long}`); } },
    );
    assert.equal(d.flashErrorCode, "http_5xx");
    assert.ok(d.flashErrorMessage !== undefined);
    assert.ok((d.flashErrorMessage?.length ?? 0) <= 200);
  });

  it("длинный текст + flash_error → simple, не medium", async () => {
    const d = await routeWithFlash(
      { userText: "а".repeat(200) },
      { callFlash: async () => { throw new Error("flash_empty_content"); } },
    );
    assert.equal(d.complexity, "simple");
    assert.notEqual(d.complexity, "medium");
  });

  it("успешный flash → source flash_llm (не fallback)", async () => {
    const d = await routeWithFlash(
      { userText: "привет" },
      {
        callFlash: async () =>
          JSON.stringify({
            role: "flash",
            complexity: "trivial",
            kind: "chat_reply",
            confidence: 0.9,
            reason: "short_chat",
          }),
      },
    );
    assert.equal(d.source, "flash_llm");
    assert.equal(d.flashErrorCode, undefined);
  });
});
