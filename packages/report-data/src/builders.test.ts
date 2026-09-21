import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExpenseRow } from "./types.js";
import { classifyProblem, toProblemItem } from "./problems.js";
import { buildCompactReport } from "./builders/compact.js";
import { buildExpandedReport } from "./builders/expanded.js";

const META = {
  chatId: "-100",
  groupTitle: "Ремонт",
  period: { fromDate: null, toDate: null, fullHistory: true },
};

function row(over: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: "d1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: "Магнит",
    total: 100,
    currency: "RUB",
    confidence: 1,
    needsReview: false,
    rawText: "чек",
    kind: "receipt",
    ...over,
  };
}

const FIXTURE: ExpenseRow[] = [
  row({ id: "a", supplier: "Магнит", total: 100 }),
  row({ id: "b", supplier: "Магнит", total: null, needsReview: true }),
  row({
    id: "c",
    supplier: "Грузчик",
    total: 200,
    itemsJson: JSON.stringify([{ name: "Кабель", qty: 45, sum: 178 }, { name: "Розетка", qty: 2, sum: 22 }]),
  }),
];

test("classifyProblem: пустой чек → причины", () => {
  assert.deepEqual(classifyProblem(row({ id: "x", total: null, needsReview: true, rawText: null })), [
    "missing_total",
    "needs_review",
    "empty_raw_text",
  ]);
  assert.deepEqual(classifyProblem(row({ id: "y", total: 10 })), []);
});

test("toProblemItem: suggestedFields", () => {
  const item = toProblemItem(row({ id: "x", supplier: null, total: null }));
  assert.ok(item);
  assert.deepEqual(item!.reasons.includes("missing_total"), true);
  assert.deepEqual(item!.suggestedFields.includes("total"), true);
  assert.deepEqual(item!.suggestedFields.includes("supplier"), true);
  assert.deepEqual(item!.suggestedFields.includes("items"), true);
  assert.equal(toProblemItem(row({ id: "ok", total: 10 })), null);
});

test("buildCompactReport: сводка + поставщики", () => {
  const report = buildCompactReport(FIXTURE, META);
  assert.equal(report.format, "compact");
  assert.equal(report.summary.documentCount, 3);
  assert.equal(report.summary.withTotalCount, 2);
  assert.equal(report.summary.totalSum, 300);
  assert.equal(report.summary.problemCount, 1);
  assert.equal(report.suppliers.length, 2);
  // Магнит = 100 (только один с total), Грузчик = 200 → Грузчик первый.
  assert.equal(report.suppliers[0].supplier, "Грузчик");
  assert.equal(report.suppliers[0].total, 200);
});

test("buildExpandedReport: items из itemsJson", () => {
  const report = buildExpandedReport(FIXTURE, META);
  assert.equal(report.documents.length, 3);
  const withItems = report.documents.find((d) => d.id === "c")!;
  assert.equal(withItems.items!.length, 2);
  assert.equal(withItems.items![0].name, "Кабель");
  assert.equal(withItems.items![0].qty, 45);
});
