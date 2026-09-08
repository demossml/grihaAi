import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getModelsForProvider } from "../../../src/utils/routing/model-catalog.js";

describe("model catalog", () => {
  it("getModelsForProvider('deepseek') includes DeepSeek V4 Pro and a vision model", () => {
    const ids = getModelsForProvider("deepseek").map((m) => m.id);
    assert.ok(ids.includes("deepseek-v4-pro"));
    assert.ok(ids.includes("deepseek-v4-flash-vision-exp"));
  });

  it("getModelsForProvider('openai') returns several models", () => {
    assert.ok(getModelsForProvider("openai").length >= 3);
  });

  it("getModelsForProvider('unknown') returns empty array", () => {
    assert.deepEqual(getModelsForProvider("unknown"), []);
  });

  it("custom provider has an empty catalog (user types the model)", () => {
    assert.deepEqual(getModelsForProvider("custom"), []);
  });
});
