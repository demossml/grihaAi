import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCommitmentOverdue,
  detectDuplicateInvoices,
  detectExpenseOutliers,
  detectRepeatedFailures,
} from "../../../src/utils/finance/anomaly-detect.js";
import type { Commitment } from "../../../src/types/index.js";

const NOW = new Date("2026-09-08T12:00:00Z");

function overdue(id: string, days: number): Commitment {
  const due = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return {
    id,
    userId: "u1",
    text: `задача ${id}`,
    dueDate: due,
    status: "overdue",
    confidence: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe("anomaly detection", () => {
  it("flags overdue commitments as anomalies", () => {
    const out = detectCommitmentOverdue([overdue("c1", 5)], NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "commitment_overdue");
    assert.equal(out[0].severity, "critical");
  });

  it("does not flag non-overdue commitments", () => {
    const c: Commitment = { ...overdue("c2", 0), status: "open" };
    assert.equal(detectCommitmentOverdue([c], NOW).length, 0);
  });

  it("flags duplicate invoices (same vendor + amount)", () => {
    const out = detectDuplicateInvoices([
      { id: "i1", vendor: "ООО Ромашка", amount: 1000, currency: "RUB" },
      { id: "i2", vendor: "ООО Ромашка", amount: 1000, currency: "RUB" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "duplicate_invoice");
  });

  it("flags expense spikes above the baseline multiplier", () => {
    const expenses = [
      { id: "e1", amount: 100, currency: "RUB" },
      { id: "e2", amount: 120, currency: "RUB" },
      { id: "e3", amount: 90, currency: "RUB" },
      { id: "e4", amount: 5000, currency: "RUB" },
    ];
    const out = detectExpenseOutliers(expenses, { multiplier: 3 });
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "expense_spike");
    assert.equal(out[0].evidence.expenseId, "e4");
  });

  it("does not flag small samples", () => {
    const out = detectExpenseOutliers([
      { id: "e1", amount: 100, currency: "RUB" },
      { id: "e2", amount: 5000, currency: "RUB" },
    ]);
    assert.equal(out.length, 0);
  });

  it("flags repeated workflow failures", () => {
    const out = detectRepeatedFailures([
      { id: "r1", status: "failed" },
      { id: "r2", status: "failed" },
      { id: "r3", status: "failed" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "repeated_failure");
  });

  it("does not flag failures below the threshold", () => {
    assert.equal(detectRepeatedFailures([{ id: "r1", status: "failed" }]).length, 0);
  });
});
