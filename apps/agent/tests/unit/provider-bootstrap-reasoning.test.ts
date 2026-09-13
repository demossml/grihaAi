/**
 * H2: makeModel всегда reasoning: true — pi-ai для DeepSeek тогда явно шлёт
 * thinking:{type:"disabled"} (без reasoningEffort), иначе параметр опускается
 * и API может уйти в неограниченный reasoning (медленно).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeModel } from "../../src/utils/bootstrap/provider-bootstrap.js";

describe("makeModel reasoning wiring", () => {
  it("sets reasoning true so DeepSeek thinking can be explicitly disabled by pi-ai", () => {
    const m = makeModel("deepseek-v4-pro", "DeepSeek V4 Pro");
    assert.equal(m.reasoning, true);
  });

  it("vision model also gets reasoning true", () => {
    const m = makeModel("deepseek-v4-flash-vision-exp", "vision", { vision: true });
    assert.equal(m.reasoning, true);
    assert.ok(m.input.includes("image"));
  });
});
