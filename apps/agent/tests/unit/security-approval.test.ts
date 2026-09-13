/**
 * Item 11.4 (E6): memory write approval gate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeMemoryWriteApprovalPolicy,
  memoryWriteNeedsApproval,
} from "../../src/runtime/security/approval.js";
import type { MemoryInput } from "../../src/runtime/memory/types.js";

const input = (over: Partial<MemoryInput> = {}): MemoryInput => ({
  type: "fact",
  content: "почта клиента",
  source: "chat",
  confidence: 0.9,
  ...over,
});

describe("Memory write approval (Item 11.4)", () => {
  it("обычный факт с высокой confidence → без одобрения", () => {
    const decision = memoryWriteNeedsApproval(input());
    assert.equal(decision.approvalRequired, false);
  });

  it("goal/constraint → требуется одобрение (дефолтная политика)", () => {
    assert.equal(memoryWriteNeedsApproval(input({ type: "goal" })).approvalRequired, true);
    assert.equal(memoryWriteNeedsApproval(input({ type: "constraint" })).approvalRequired, true);
  });

  it("низкая confidence → требуется одобрение", () => {
    const decision = memoryWriteNeedsApproval(input({ confidence: 0.1 }));
    assert.equal(decision.approvalRequired, true);
    assert.match(decision.reasons.join("; "), /confidence/);
  });

  it("кастомная политика уважается", () => {
    const policy = makeMemoryWriteApprovalPolicy({ requireForTypes: ["preference"] });
    assert.equal(memoryWriteNeedsApproval(input({ type: "preference" }), policy).approvalRequired, true);
    assert.equal(memoryWriteNeedsApproval(input({ type: "goal" }), policy).approvalRequired, false);
  });
});
