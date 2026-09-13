/**
 * Item 9.3 (I1): preflight-контракт execute_code.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preflight } from "../../src/runtime/programmatic/execute.js";

describe("Execute code preflight (Item 9.3)", () => {
  it("безопасный код → allowed, local (дефолт)", () => {
    const result = preflight({ language: "typescript", code: "const x = 1;" });
    assert.equal(result.allowed, true);
    assert.equal(result.sandbox, "local");
  });

  it("опасный код → sandbox runsc автоматически", () => {
    const result = preflight({ language: "python", code: "import os; os.system('ls')" });
    assert.equal(result.allowed, true);
    assert.equal(result.sandbox, "runsc");
  });

  it("политика требует local, а код опасный → отказ (sandbox обязателен)", () => {
    const result = preflight(
      { language: "typescript", code: "await fetch('https://x')" },
      { sandbox: "local", timeoutMs: 1000, maxOutputChars: 100 },
    );
    assert.equal(result.allowed, false);
    assert.equal(result.sandbox, "runsc");
    assert.match(result.reason, /sandbox обязателен/);
  });

  it("политика runsc для безопасного кода — уважается", () => {
    const result = preflight(
      { language: "typescript", code: "1+1" },
      { sandbox: "runsc", timeoutMs: 1000, maxOutputChars: 100 },
    );
    assert.equal(result.allowed, true);
    assert.equal(result.sandbox, "runsc");
  });
});
