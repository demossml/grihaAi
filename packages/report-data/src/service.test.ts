import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportDataService } from "./service.js";
import type { ExpenseRow, ExpensesReader } from "./types.js";

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

const reader: ExpensesReader = {
  async listExpenses() {
    return [
      row({ id: "a", total: 100 }),
      row({ id: "b", total: null, needsReview: true, supplier: null }),
    ];
  },
};

test("buildExpenseReport compact ok (group title из getGroupTitle)", async () => {
  const service = createReportDataService({ reader, getGroupTitle: async () => "Ремонт" });
  const res = await service.buildExpenseReport({ chatId: "-100", format: "compact" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.report.groupTitle, "Ремонт");
  assert.equal(res.report.summary.documentCount, 2);
  assert.equal(res.report.summary.problemCount, 1);
});

test("buildExpenseReport expanded ok", async () => {
  const service = createReportDataService({ reader });
  const res = await service.buildExpenseReport({ chatId: "-100", format: "expanded" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.report.format, "expanded");
  assert.equal(res.report.documents.length, 2);
});

test("listProblemExpenses count", async () => {
  const service = createReportDataService({ reader });
  const res = await service.listProblemExpenses({ chatId: "-100" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.problems.count >= 1);
  assert.equal(res.problems.items[0].id, "b");
});

test("missing chatId → MISSING_CHAT_ID", async () => {
  const service = createReportDataService({ reader });
  const res = await service.buildExpenseReport({ chatId: "", format: "compact" });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "MISSING_CHAT_ID");
});

test("invalid period → INVALID_PERIOD", async () => {
  const service = createReportDataService({ reader });
  const res = await service.buildExpenseReport({
    chatId: "-100",
    format: "compact",
    period: { fromDate: "2026-9-1" },
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "INVALID_PERIOD");
});
