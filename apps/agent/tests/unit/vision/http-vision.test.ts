import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpVisionCaller,
  resolveVisionBaseUrl,
} from "../../../src/utils/vision/http-vision.js";
import type { ModelConfig } from "@griha/shared-types";

function makeFetch(status: number, json: unknown) {
  return (async (_url: string, init: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
      json: async () => json,
    };
  }) as unknown as typeof fetch;
}

const vision: ModelConfig = {
  provider: "openai",
  model: "gpt-4o",
  apiKey: "sk-test",
  baseUrl: "https://api.openai.com/v1/",
};

describe("http vision caller", () => {
  it("posts to /chat/completions with model, auth and base64 image", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ choices: [{ message: { content: "ТЕКСТ С ФОТО" } }] }),
      };
    }) as unknown as typeof fetch;

    const caller = createHttpVisionCaller({ fetchFn });
    const text = await caller(vision, { source: "base64", value: "aGVsbG8=" }, "ocr", "ru");

    assert.equal(text, "ТЕКСТ С ФОТО");
    assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(
      (captured.init!.headers as Record<string, string>).Authorization,
      "Bearer sk-test",
    );

    const body = JSON.parse(String(captured.init!.body)) as {
      model: string;
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    assert.equal(body.model, "gpt-4o");
    const content = body.messages[0].content;
    assert.equal(content[0].type, "text");
    assert.equal(content[1].type, "image_url");
    assert.equal(content[1].image_url?.url, "data:image/jpeg;base64,aGVsbG8=");
  });

  it("passes a url image through as image_url", async () => {
    let body: unknown;
    const caller = createHttpVisionCaller({
      fetchFn: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        };
      }) as unknown as typeof fetch,
    });

    await caller(vision, { source: "url", value: "https://x/y.png" }, "describe");

    const messages = (body as { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> }).messages;
    assert.equal(messages[0].content[1].image_url?.url, "https://x/y.png");
  });

  it("parses array-form content into text", async () => {
    const caller = createHttpVisionCaller({
      fetchFn: makeFetch(200, {
        choices: [{ message: { content: [{ type: "text", text: "часть1" }, { type: "text", text: "часть2" }] } }],
      }),
    });
    const text = await caller(vision, { source: "base64", value: "x" }, "ocr");
    assert.equal(text, "часть1часть2");
  });

  it("rejects when the image source is an unresolved Telegram file id", async () => {
    const caller = createHttpVisionCaller({ fetchFn: makeFetch(200, {}) });
    await assert.rejects(
      () => caller(vision, { source: "file", value: "AgAC..." }, "ocr"),
      /file_id/,
    );
  });

  it("rejects when the provider has no API key", async () => {
    const caller = createHttpVisionCaller({ fetchFn: makeFetch(200, {}) });
    await assert.rejects(
      () => caller({ ...vision, apiKey: undefined }, { source: "url", value: "u" }, "ocr"),
      /no API key/,
    );
  });

  it("throws a clear error on a non-ok response", async () => {
    const caller = createHttpVisionCaller({
      fetchFn: makeFetch(401, { error: "bad key" }),
    });
    await assert.rejects(
      () => caller(vision, { source: "url", value: "u" }, "ocr"),
      /Vision API error 401/,
    );
  });
});

describe("resolveVisionBaseUrl", () => {
  it("prefers the explicit baseUrl and trims trailing slashes", () => {
    assert.equal(resolveVisionBaseUrl(vision), "https://api.openai.com/v1");
  });

  it("defaults deepseek to its official endpoint", () => {
    assert.equal(
      resolveVisionBaseUrl({ provider: "deepseek", model: "m" }),
      "https://api.deepseek.com",
    );
  });
});
