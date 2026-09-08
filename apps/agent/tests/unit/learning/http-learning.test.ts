import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpLearningLlm,
  resolveLearningModel,
} from "../../../src/utils/learning/http-learning.js";
import type { GrishAiConfig } from "@griha/shared-types";

function baseConfig(overrides: Partial<GrishAiConfig> = {}): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "sk-test",
    setupCompletedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("http learning llm", () => {
  it("calls /chat/completions with the configured model and auth", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ choices: [{ message: { content: "{\"facts\":[]}" } }] }),
      };
    }) as unknown as typeof fetch;

    const llm = createHttpLearningLlm(baseConfig(), { fetchFn });
    const out = await llm("prompt");

    assert.equal(out, "{\"facts\":[]}");
    assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
    assert.equal(
      (captured.init!.headers as Record<string, string>).Authorization,
      "Bearer sk-test",
    );
    const body = JSON.parse(String(captured.init!.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, "deepseek-chat");
    assert.deepEqual(body.messages, [{ role: "user", content: "prompt" }]);
  });

  it("throws a clear error on a non-ok response", async () => {
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const llm = createHttpLearningLlm(baseConfig(), { fetchFn });
    await assert.rejects(() => llm("p"), /Learning LLM error 500/);
  });

  it("throws when no API key is configured", async () => {
    const llm = createHttpLearningLlm(baseConfig({ apiKey: undefined }), {
      fetchFn: (async () => ({})) as unknown as typeof fetch,
    });
    await assert.rejects(() => llm("p"), /no API key/);
  });
});

describe("resolveLearningModel", () => {
  it("prefers models.main and falls back to the legacy fields", () => {
    const main = resolveLearningModel(
      baseConfig({ models: { main: { provider: "openai", model: "gpt-4o", apiKey: "k" } } }),
    );
    assert.equal(main.model, "gpt-4o");

    const legacy = resolveLearningModel(baseConfig({ model: "deepseek-chat" }));
    assert.equal(legacy.model, "deepseek-chat");
    assert.equal(legacy.provider, "deepseek");
  });
});
