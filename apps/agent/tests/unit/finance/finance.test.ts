import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeTransaction,
  summarizeExpenses,
  comparePeriods,
  parseExpenseFromOcr,
} from "../../../src/utils/finance/finance.js";

describe("transaction categorization", () => {
  const history = [{ vendor: "Uber", category: "Transport" }];

  it("uses exact history match with high confidence", () => {
    const r = categorizeTransaction("uber", history);
    assert.equal(r.category, "Transport");
    assert.equal(r.needsConfirmation, false);
    assert.ok(r.confidence >= 0.8);
  });

  it("does not auto-apply category to similar vendors", () => {
    const r = categorizeTransaction("Uber Eats", history);
    assert.equal(r.needsConfirmation, true);
  });

  it("asks for unknown vendors", () => {
    const r = categorizeTransaction("Some New Shop", history);
    assert.equal(r.needsConfirmation, true);
    assert.equal(r.category, undefined);
  });
});

describe("expense summary", () => {
  it("totals by category and vendor", () => {
    const s = summarizeExpenses([
      { id: "1", userId: "u", date: "2026-09-01", vendor: "A", amount: 100, currency: "RUB", category: "Transport", confidence: 1, source: "manual", createdAt: "x" },
      { id: "2", userId: "u", date: "2026-09-02", vendor: "B", amount: 300, currency: "RUB", category: "Food", confidence: 1, source: "manual", createdAt: "x" },
      { id: "3", userId: "u", date: "2026-09-03", vendor: "A", amount: 50, currency: "RUB", category: "Transport", confidence: 1, source: "manual", createdAt: "x" },
    ]);
    assert.equal(s.total, 450);
    assert.equal(s.byCategory.Transport, 150);
    assert.equal(s.byVendor.A, 150);
    assert.equal(s.count, 3);
  });

  it("compares periods", () => {
    const c = comparePeriods(1200, 1000);
    assert.equal(c.delta, 200);
    assert.equal(c.deltaPct, 20);
    assert.equal(comparePeriods(500, 0).deltaPct, null);
  });
});

describe("OCR expense parsing", () => {
  it("extracts amount, currency, vendor and date", () => {
    const r = parseExpenseFromOcr("ООО Ромашка\nСумма: 1 500,50 ₽\nДата: 05.09.2026");
    assert.equal(r.amount, 1500.5);
    assert.equal(r.currency, "RUB");
    assert.equal(r.vendor, "ООО Ромашка");
    assert.equal(r.date, "05.09.2026");
    assert.equal(r.missing.length, 0);
  });

  it("reports missing critical fields", () => {
    const r = parseExpenseFromOcr("какой-то чек без суммы");
    assert.ok(r.missing.includes("amount"));
    assert.ok(r.missing.includes("date"));
  });
});
