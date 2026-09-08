import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRouter } from "../../../src/utils/routing/model-router.js";
import {
  analyzeImage,
  runAnalyzeImage,
  type VisionCaller,
} from "../../../src/utils/vision/image-analyzer.js";
import { loadConfig, saveConfig } from "@griha/config";
import type { GrishAiConfig } from "@griha/shared-types";

function baseConfig(overrides: Partial<GrishAiConfig> = {}): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-chat",
    setupCompletedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("model router", () => {
  it("returns the right config for main and vision", () => {
    const cfg = baseConfig({
      models: {
        main: { provider: "deepseek", model: "deepseek-v4-pro" },
        vision: { provider: "openai", model: "gpt-4o" },
      },
    });
    const router = new ModelRouter(cfg);
    assert.equal(router.getConfig("main").model, "deepseek-v4-pro");
    assert.equal(router.getConfig("vision").model, "gpt-4o");
  });

  it("falls back to provider/model for old configs without models", () => {
    const cfg = baseConfig({ provider: "openai", model: "gpt-4o" });
    const router = new ModelRouter(cfg);
    assert.equal(router.getConfig("main").provider, "openai");
    assert.equal(router.getConfig("main").model, "gpt-4o");
  });

  it("throws when vision is not configured", () => {
    const router = new ModelRouter(baseConfig());
    assert.throws(() => router.getConfig("vision"), /Vision model is not configured/);
  });
});

describe("analyze image", () => {
  const mockVision: VisionCaller = async (_vision, image, task, languageHint) =>
    `${task}:${image.source}:${image.value}${languageHint ? `:${languageHint}` : ""}`;

  it("returns text with a mock vision model", async () => {
    const cfg = baseConfig({
      models: {
        main: { provider: "deepseek", model: "deepseek-chat" },
        vision: { provider: "openai", model: "gpt-4o" },
      },
    });
    const res = await runAnalyzeImage(cfg, { imageBase64: "abc", task: "ocr" }, mockVision);
    assert.equal(res.ok, true);
    assert.equal(res.text, "ocr:base64:abc");
  });

  it("returns a clear error when vision is not configured", async () => {
    const res = await runAnalyzeImage(baseConfig(), { imageBase64: "abc", task: "ocr" }, mockVision);
    assert.equal(res.ok, false);
    assert.match(res.text, /Vision model is not configured/);
  });

  it("analyzeImage throws when no image provided", async () => {
    await assert.rejects(
      () => analyzeImage({ task: "ocr" }, mockVision, { provider: "openai", model: "gpt-4o" }),
      /No image provided/,
    );
  });
});

describe("multi-model config", () => {
  it("saves and reads config with main + vision", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mr-cfg-"));
    process.env.GRISH_AI_HOME = dir;
    try {
      saveConfig(
        baseConfig({
          models: {
            main: { provider: "deepseek", model: "deepseek-v4-pro" },
            vision: { provider: "openai", model: "gpt-4o" },
          },
        }),
      );
      const loaded = loadConfig();
      assert.equal(loaded?.models?.main?.model, "deepseek-v4-pro");
      assert.equal(loaded?.models?.vision?.model, "gpt-4o");
    } finally {
      delete process.env.GRISH_AI_HOME;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
