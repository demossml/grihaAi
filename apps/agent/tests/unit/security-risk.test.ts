/**
 * Item 11.1 (K2/§24/§25): уровни риска + approval-политика.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyAction, requiresApproval } from "../../src/runtime/security/risk.js";

describe("Action risk (Item 11.1)", () => {
  it("§25 классификация: read→safe, write/send→medium, delete/financial→high, system→critical", () => {
    assert.equal(classifyAction("read_file").level, "safe");
    assert.equal(classifyAction("write_file").level, "medium");
    assert.equal(classifyAction("send_message").level, "medium");
    assert.equal(classifyAction("delete_file").level, "high");
    assert.equal(classifyAction("financial").level, "high");
    assert.equal(classifyAction("system_modification").level, "critical");
  });

  it("дефолтная политика: medium+ требует одобрения, safe/low — нет", () => {
    assert.equal(requiresApproval("read_file").required, false);
    assert.equal(requiresApproval("memory_write").required, false);
    assert.equal(requiresApproval("write_file").required, true);
    assert.equal(requiresApproval("system_modification").required, true);
  });

  it("alwaysAllow/alwaysRequire переопределяют порог", () => {
    const policy = { approvalThreshold: "low" as const, alwaysAllow: ["send_message" as const], alwaysRequire: ["read_file" as const] };
    assert.equal(requiresApproval("send_message", policy).required, false);
    assert.equal(requiresApproval("read_file", policy).required, true);
  });

  it("кастомный порог high: delete не требует, system требует", () => {
    const policy = { approvalThreshold: "high" as const };
    assert.equal(requiresApproval("delete_file", policy).required, true);
    assert.equal(requiresApproval("financial", policy).required, true);
    assert.equal(requiresApproval("write_file", policy).required, false);
  });
});
