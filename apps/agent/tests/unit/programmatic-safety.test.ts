/**
 * Item 9.2 (I1): классификация риска кода + выбор sandbox.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodeRisk,
  sandboxDecision,
  sandboxForRisk,
} from "../../src/runtime/programmatic/safety.js";

describe("Code risk (Item 9.2)", () => {
  it("безопасный код → safe → local sandbox", () => {
    const report = classifyCodeRisk("const x = a + b; console.log(x);");
    assert.equal(report.level, "safe");
    assert.equal(sandboxForRisk(report), "local");
    assert.equal(sandboxDecision(report).mandatory, false);
  });

  it("network → dangerous", () => {
    const report = classifyCodeRisk("await fetch('https://evil.example')");
    assert.equal(report.level, "dangerous");
    assert.ok(report.reasons.includes("network access"));
  });

  it("fs write + process → dangerous", () => {
    const report = classifyCodeRisk("fs.writeFileSync('/etc/x', 'y'); execSync('ls');");
    assert.equal(report.level, "dangerous");
    assert.ok(report.reasons.includes("filesystem write/delete"));
    assert.ok(report.reasons.includes("process execution"));
  });

  it("eval → dangerous", () => {
    const report = classifyCodeRisk("eval('x')");
    assert.equal(report.level, "dangerous");
    assert.ok(report.reasons.includes("dynamic code evaluation"));
  });

  it("secrets/env доступ → dangerous", () => {
    const report = classifyCodeRisk("const k = process.env.API_KEY");
    assert.equal(report.level, "dangerous");
    assert.ok(report.reasons.includes("secrets/env access"));
  });

  it("опасный код → runsc обязателен", () => {
    const decision = sandboxDecision(classifyCodeRisk("fetch('http://x')"));
    assert.equal(decision.sandbox, "runsc");
    assert.equal(decision.mandatory, true);
    assert.match(decision.reason, /sandbox обязателен/);
  });
});
