/**
 * R6: mapper expenses DB → ExpenseReportInput (rich). Проверяем структуру:
 * group title, поставщики, развёртка чеков с позициями (itemsJson), fallback
 * без items, пустая БД → ошибка.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExpenseReportInput,
  EXPENSE_REPORT_EMPTY_MESSAGE,
} from "../../../src/services/documents/expenseReportTools.js";
import { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../../src/services/documents/types.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "doc-1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: "Магнит",
    total: 507.99,
    currency: "RUB",
    kind: "receipt",
    confidence: 1,
    needsReview: false,
    source: "telegram",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("buildExpenseReportInput (R6)", () => {
  it("строит структуру: groupTitle + сводка + поставщики + чеки с позициями", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        fileName: "receipt-1.jpg",
        itemsJson: JSON.stringify([
          { name: "Кабель ВВГ 3x2,5", qty: 45, sum: 178 },
          { name: "Розетка", qty: 2, sum: 329.99 },
        ]),
      }),
    );

    const built = await buildExpenseReportInput(
      repo,
      { chatId: "-100", period: "сентябрь" },
      { getChatTitle: (id) => (id === "-100" ? "Ремонт" : undefined) },
    );
    assert.ok(built.ok, JSON.stringify(built));
    if (!built.ok) return;

    const data = built.data;
    assert.equal(data.groupTitle, "Ремонт");
    assert.equal(data.periodLabel, "сентябрь");
    assert.equal(data.summary.documents, 1);
    assert.equal(data.summary.suppliers, 1);
    assert.equal(data.summary.lineItems, 2);
    assert.equal(data.suppliers.length, 1);
    assert.equal(data.suppliers[0].supplier, "Магнит");
    assert.equal(data.suppliers[0].receiptCount, 1);
    assert.equal(data.receipts.length, 1);
    assert.equal(data.receipts[0].title, "Чек №1 · Магнит");
    assert.equal(data.receipts[0].items.length, 2);
    assert.equal(data.receipts[0].items[0].name, "Кабель ВВГ 3x2,5");
    assert.equal(data.receipts[0].items[0].qtyLabel, "45");
  });

  it("чек без items → одна позиция = total чека (не падает)", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ itemsJson: undefined }));

    const built = await buildExpenseReportInput(repo, { chatId: "-100" });
    assert.ok(built.ok, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.data.receipts.length, 1);
    assert.equal(built.data.receipts[0].items.length, 1);
    assert.equal(built.data.receipts[0].items[0].qtyLabel, "1");
  });

  it("пустая БД → ошибка (guard E2)", async () => {
    const repo = makeRepo();
    const built = await buildExpenseReportInput(repo, { chatId: "-100" });
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.error, EXPENSE_REPORT_EMPTY_MESSAGE);
  });
});
