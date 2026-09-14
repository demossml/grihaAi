/**
 * B5 (post-wiring): отдельные aux-модели.
 * - схема `models.*`: слоты title/compression/summarization/approval/delegation/learning;
 * - `resolveModelConfig`: слот → main → legacy;
 * - learning-вызов (`resolveLearningModel`/`createHttpLearningLlm`) за флагом.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import { AUX_MODEL_ROLES } from "../../src/runtime/model/index.js";
import { resolveModelConfig } from "../../src/runtime/model/select.js";
import {
  createHttpLearningLlm,
  resolveLearningModel,
} from "../../src/utils/learning/http-learning.js";

const ON: NodeJS.ProcessEnv = { GRIHA_AGENT_RUNTIME: "1" };
const OFF: NodeJS.ProcessEnv = {};

function cfg(partial: Partial<GrishAiConfig> = {}): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "legacy-key",
    baseUrl: "https://legacy.example.com",
    setupCompletedAt: "2026-01-01",
    ...partial,
  };
}

describe("B5: aux-модели (слоты + learning wiring)", () => {
  it("AUX_MODEL_ROLES содержит шесть ролей без main/vision/embedding", () => {
    assert.deepEqual([...AUX_MODEL_ROLES].sort(), [
      "approval",
      "compression",
      "delegation",
      "learning",
      "summarization",
      "title",
    ]);
  });

  it("resolveModelConfig: заданный aux-слот возвращается", () => {
    const config = cfg({
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" },
        compression: { provider: "deepseek", model: "deepseek-v4-lite", apiKey: "c" },
      },
    });
    assert.equal(resolveModelConfig(config, "compression").model, "deepseek-v4-lite");
    // main не затирается слотом другой роли
    assert.equal(resolveModelConfig(config, "main").model, "deepseek-v4-flash");
  });

  it("resolveModelConfig: aux без слота падает на main, затем legacy", () => {
    const withMain = cfg({
      models: { main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" } },
    });
    assert.equal(resolveModelConfig(withMain, "title").model, "deepseek-v4-flash");

    const legacy = cfg();
    const resolved = resolveModelConfig(legacy, "approval");
    assert.equal(resolved.provider, "deepseek");
    assert.equal(resolved.model, "deepseek-v4-pro");
    assert.equal(resolved.apiKey, "legacy-key");
  });

  it("resolveLearningModel: флаг off игнорирует слот learning (1:1 старое)", () => {
    const config = cfg({
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" },
        learning: { provider: "deepseek", model: "deepseek-v4-learn", apiKey: "l" },
      },
    });
    const resolved = resolveLearningModel(config, OFF);
    assert.equal(resolved.model, "deepseek-v4-flash");
  });

  it("resolveLearningModel: флаг on берёт слот learning", () => {
    const config = cfg({
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" },
        learning: { provider: "deepseek", model: "deepseek-v4-learn", apiKey: "l" },
      },
    });
    const resolved = resolveLearningModel(config, ON);
    assert.equal(resolved.model, "deepseek-v4-learn");
  });

  it("resolveLearningModel: флаг on без слота падает на main → legacy", () => {
    const withMain = cfg({
      models: { main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" } },
    });
    assert.equal(resolveLearningModel(withMain, ON).model, "deepseek-v4-flash");

    const legacy = cfg();
    const resolved = resolveLearningModel(legacy, ON);
    assert.equal(resolved.model, "deepseek-v4-pro");
    assert.equal(resolved.apiKey, "legacy-key");
  });

  it("createHttpLearningLlm: флаг on вызывает learning-модель и её baseUrl", async () => {
    const config = cfg({
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "m" },
        learning: {
          provider: "openrouter",
          model: "cheap/learn",
          apiKey: "learn-key",
          baseUrl: "https://learn.example.com",
        },
      },
    });
    const captured: { url?: string; bodyModel?: string } = {};
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.bodyModel = (JSON.parse(String(init.body)) as { model: string }).model;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    }) as unknown as typeof fetch;

    const llm = createHttpLearningLlm(config, { fetchFn, env: ON });
    const out = await llm("prompt");
    assert.equal(out, "ok");
    assert.equal(captured.url, "https://learn.example.com/chat/completions");
    assert.equal(captured.bodyModel, "cheap/learn");
  });
});
