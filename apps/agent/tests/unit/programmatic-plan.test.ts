/**
 * Item 9.1 (I1): решение о скрипте вместо tool calls + компактный результат.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactExecutionResult,
  planSatisfied,
  shouldUseExecuteCode,
} from "../../src/runtime/programmatic/plan.js";

describe("Execute code planning (Item 9.1)", () => {
  it("3+ tool calls → скрипт (threshold)", () => {
    assert.equal(shouldUseExecuteCode(3).useCode, true);
    assert.equal(shouldUseExecuteCode(2).useCode, false);
  });

  it("кастомный порог", () => {
    assert.equal(shouldUseExecuteCode(2, { toolCallThreshold: 2 }).useCode, true);
  });

  it("compactExecutionResult: содержит exitCode/operations/stdout", () => {
    const out = compactExecutionResult({ stdout: "a\nb\nc", stderr: "", exitCode: 0, operationCount: 3 });
    assert.match(out, /exitCode: 0/);
    assert.match(out, /operations: 3/);
    assert.match(out, /stdout:\na\nb\nc/);
  });

  it("compactExecutionResult: обрезает до maxChars", () => {
    const out = compactExecutionResult(
      { stdout: "x".repeat(5000), stderr: "", exitCode: 0, operationCount: 1 },
      100,
    );
    assert.ok(out.length <= 100);
  });

  it("planSatisfied: exitCode 0 + expectedResult в stdout", () => {
    const plan = { language: "python" as const, code: "print('ok')", replacesToolCalls: 4, expectedResult: "ok" };
    assert.equal(planSatisfied(plan, { stdout: "ok", stderr: "", exitCode: 0, operationCount: 1 }), true);
    assert.equal(planSatisfied(plan, { stdout: "no", stderr: "", exitCode: 0, operationCount: 1 }), false);
    assert.equal(planSatisfied(plan, { stdout: "ok", stderr: "", exitCode: 1, operationCount: 1 }), false);
  });

  it("plan без expectedResult: только exitCode", () => {
    const plan = { language: "typescript" as const, code: "x", replacesToolCalls: 3 };
    assert.equal(planSatisfied(plan, { stdout: "", stderr: "", exitCode: 0, operationCount: 1 }), true);
    assert.equal(planSatisfied(plan, { stdout: "", stderr: "", exitCode: 2, operationCount: 1 }), false);
  });
});
