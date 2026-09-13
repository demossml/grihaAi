/**
 * Item 10.3 (J4): script jobs — валидация и отчёт.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scriptResultReport,
  validateScriptJob,
} from "../../src/runtime/automation/script.js";

describe("Script jobs (Item 10.3)", () => {
  it("валидный spec", () => {
    const result = validateScriptJob({ command: "ls -la", timeoutMs: 1000, maxOutputChars: 100 });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("пустая команда → ошибка", () => {
    const result = validateScriptJob({ command: "  ", timeoutMs: 1000, maxOutputChars: 100 });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /command must not be empty/);
  });

  it("некорректные timeout/maxOutput → ошибки", () => {
    const result = validateScriptJob({ command: "ls", timeoutMs: 0, maxOutputChars: -1 });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
  });

  it("scriptResultReport: компактный отчёт без LLM", () => {
    const report = scriptResultReport({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 12 });
    assert.match(report, /exitCode: 0/);
    assert.match(report, /durationMs: 12/);
    assert.match(report, /stdout:\nok/);
  });

  it("scriptResultReport: обрезка до maxChars", () => {
    const report = scriptResultReport(
      { exitCode: 0, stdout: "x".repeat(5000), stderr: "", durationMs: 1 },
      100,
    );
    assert.ok(report.length <= 100);
  });

  it("scriptResultReport: stderr включается", () => {
    const report = scriptResultReport({ exitCode: 1, stdout: "", stderr: "boom", durationMs: 1 });
    assert.match(report, /stderr:\nboom/);
  });
});
