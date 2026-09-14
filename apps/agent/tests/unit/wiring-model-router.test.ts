/**
 * Wiring W1: ModelRouter через runtime-слой — паритет off/on + aux fallback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import { ModelRouter, type ModelRole } from "../../src/utils/routing/model-router.js";

const config: GrishAiConfig = {
  version: 1,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "k",
  baseUrl: "https://api.deepseek.com",
  setupCompletedAt: "2026-01-01",
  models: {
    main: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "k" },
    vision: { provider: "deepseek", model: "deepseek-v4-flash-vision-exp", apiKey: "k" },
  },
};

const legacy: GrishAiConfig = { ...config, models: undefined };

describe("ModelRouter wiring (W1)", () => {
  it("flag off: поведение 1:1 прежнее (main/vision)", () => {
    const router = new ModelRouter(config, undefined, {});
    assert.equal(router.getConfig("main").model, "deepseek-v4-flash");
    assert.equal(router.getConfig("vision").model, "deepseek-v4-flash-vision-exp");
    assert.equal(router.selectForTask({ kind: "chat" }), null);
  });

  it("flag on: main/vision идентичны off (паритет)", () => {
    const router = new ModelRouter(config, undefined, { GRIHA_AGENT_RUNTIME: "1" });
    assert.equal(router.getConfig("main").model, "deepseek-v4-flash");
    assert.equal(router.getConfig("vision").model, "deepseek-v4-flash-vision-exp");
  });

  it("flag on: aux-роль падает на main", () => {
    const router = new ModelRouter(config, undefined, { GRIHA_AGENT_RUNTIME: "1" });
    const title = router.getConfig("title" as ModelRole);
    assert.equal(title.model, "deepseek-v4-flash");
  });

  it("flag on: legacy config без models → top-level (как и раньше)", () => {
    const router = new ModelRouter(legacy, undefined, { GRIHA_AGENT_RUNTIME: "1" });
    assert.equal(router.getConfig("main").model, "deepseek-v4-pro");
  });

  it("flag on: vision без конфига → ошибка (как и раньше)", () => {
    const router = new ModelRouter(legacy, undefined, { GRIHA_AGENT_RUNTIME: "1" });
    assert.throws(() => router.getConfig("vision"), /Vision model is not configured/);
  });

  it("selectForTask: flag on → детерминированный выбор (B2)", () => {
    const router = new ModelRouter(config, undefined, { GRIHA_AGENT_RUNTIME: "1" });
    assert.equal(router.selectForTask({ kind: "ocr", needsVision: true }), "vision");
    assert.equal(router.selectForTask({ kind: "chat" }), "main");
  });
});
