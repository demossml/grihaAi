/**
 * Item 2.2 (B2): детерминированный выбор роли и конфига.
 * Семантика main/vision проверяется против прод-поведения ModelRouter.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import { resolveModelConfig, selectModelRole } from "../../src/runtime/model/select.js";

function cfg(partial: Partial<GrishAiConfig> = {}): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "k",
    baseUrl: "https://api.deepseek.com",
    setupCompletedAt: "2026-01-01",
    ...partial,
  };
}

describe("Model select (Item 2.2)", () => {
  it("TaskProfile: preferredRole приоритетнее capabilities", () => {
    assert.equal(
      selectModelRole({ kind: "chat", preferredRole: "approval", needsVision: true }),
      "approval",
    );
  });

  it("needsVision → vision, needsEmbedding → embedding, иначе main", () => {
    assert.equal(selectModelRole({ kind: "ocr", needsVision: true }), "vision");
    assert.equal(selectModelRole({ kind: "index", needsEmbedding: true }), "embedding");
    assert.equal(selectModelRole({ kind: "chat" }), "main");
  });

  it("resolveModelConfig: vision без конфига → ошибка (парность с prod)", () => {
    assert.throws(() => resolveModelConfig(cfg(), "vision"), /Vision model is not configured/);
  });

  it("resolveModelConfig: vision из models.vision", () => {
    const config = cfg({
      models: {
        vision: { provider: "deepseek", model: "deepseek-v4-flash-vision-exp", apiKey: "k" },
      },
    });
    assert.equal(resolveModelConfig(config, "vision").model, "deepseek-v4-flash-vision-exp");
  });

  it("resolveModelConfig: main из models.main, aux-роль падает на main", () => {
    const config = cfg({
      models: { main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "k" } },
    });
    assert.equal(resolveModelConfig(config, "main").model, "deepseek-v4-flash");
    assert.equal(resolveModelConfig(config, "title").model, "deepseek-v4-flash");
  });

  it("resolveModelConfig: legacy config без models → top-level (парность с prod)", () => {
    const config = cfg();
    const resolved = resolveModelConfig(config, "main");
    assert.equal(resolved.provider, "deepseek");
    assert.equal(resolved.model, "deepseek-v4-pro");
    assert.equal(resolved.apiKey, "k");
  });
});
