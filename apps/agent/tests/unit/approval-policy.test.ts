import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAction,
  requiresApproval,
} from "../../src/utils/approval-policy.js";

describe("approval policy", () => {
  it("classifies read-only actions", () => {
    assert.equal(classifyAction("memory_search"), "READ_ONLY");
    assert.equal(classifyAction("get_user_profile"), "READ_ONLY");
    assert.equal(classifyAction("commitment_list"), "READ_ONLY");
  });

  it("classifies high-risk / irreversible actions", () => {
    assert.equal(classifyAction("email.send"), "HIGH_RISK_IRREVERSIBLE");
    assert.equal(classifyAction("invoice.pay"), "HIGH_RISK_IRREVERSIBLE");
    assert.equal(classifyAction("delete_contact"), "HIGH_RISK_IRREVERSIBLE");
    assert.equal(classifyAction("book_flight"), "HIGH_RISK_IRREVERSIBLE");
  });

  it("classifies reversible mutations", () => {
    assert.equal(classifyAction("commitment_add"), "REVERSIBLE_LOW_RISK");
    assert.equal(classifyAction("draft_email"), "REVERSIBLE_LOW_RISK");
  });

  it("requires approval for high-risk regardless of policy", () => {
    const decision = requiresApproval("email.send", {
      policy: { currency: "RUB", autoApproveBelow: 1000000 },
    });
    assert.equal(decision.required, true);
    assert.equal(decision.actionClass, "HIGH_RISK_IRREVERSIBLE");
  });

  it("read-only never requires approval", () => {
    const decision = requiresApproval("memory_search");
    assert.equal(decision.required, false);
  });

  it("confirms financial action when no policy is set", () => {
    const decision = requiresApproval("invoice.pay", { amount: 100 });
    assert.equal(decision.required, true);
  });

  it("auto-approves below threshold", () => {
    const decision = requiresApproval("expense.add", {
      amount: 500,
      policy: { currency: "RUB", autoApproveBelow: 1000 },
    });
    assert.equal(decision.required, false);
  });

  it("confirms at/above always-confirm threshold", () => {
    const decision = requiresApproval("expense.add", {
      amount: 100000,
      policy: { currency: "RUB", autoApproveBelow: 1000, alwaysConfirmAbove: 50000 },
    });
    assert.equal(decision.required, true);
    assert.match(decision.reason, /always-confirm/);
  });

  it("confirms categories in the always-confirm list", () => {
    const decision = requiresApproval("expense.add", {
      amount: 100,
      category: "travel",
      policy: {
        currency: "RUB",
        autoApproveBelow: 1000,
        categoriesAlwaysConfirm: ["travel"],
      },
    });
    assert.equal(decision.required, true);
    assert.match(decision.reason, /travel/);
  });
});
