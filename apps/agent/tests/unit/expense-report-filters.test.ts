/**
 * F5: фильтры отчёта — позиции с sum 0 / ИНН-like не попадают в список;
 * итог = doc.total (БД), needsReview-чеки не смешиваются с успешными.
 * + backfill reparseExpenseFromRaw (dry-run / apply).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExpenseReportData,
  buildExpenseReportInput,
} from "../../src/services/documents/expenseReportTools.js";
import { reparseExpenseFromRaw } from "../../src/services/documents/backfill.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flt-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "doc-1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: "Магнит",
    total: 599.6,
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

describe("expense report filters (F5)", () => {
  it("позиции с sum 0 и ИНН-like не попадают в список трат", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        fileName: "receipt-1.jpg",
        total: 599.6,
        itemsJson: JSON.stringify([
          { name: "КАССОВЫЙ ЧЕК", sum: 0 },
          { name: "ИНН строка", sum: 7717664244 },
          { name: "Хлеб", qty: 1, sum: 50 },
          { name: "Молоко", qty: 1, sum: 549.6 },
        ]),
      }),
    );

    const built = await buildExpenseReportInput(repo, { chatId: "-100" });
    assert.ok(built.ok, JSON.stringify(built));
    if (!built.ok) return;

    const items = built.data.receipts[0].items;
    const names = items.map((i) => i.name);
    assert.ok(names.includes("Хлеб"), "валидная позиция есть");
    assert.ok(names.includes("Молоко"), "валидная позиция есть");
    assert.ok(!names.some((n) => /КАССОВЫЙ ЧЕК|ИНН/i.test(n)), "мусор (sum 0 / ИНН) скрыт");
    assert.ok(!items.some((i) => i.amountLabel.includes("7717664244")), "ИНН не в списке");
  });

  it("итог = doc.total из БД, а не сумма позиций", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: 599.6 }));
    await repo.insert(makeDoc({ id: "doc-2", total: 1000, docDate: "2026-09-12" }));

    const built = await buildExpenseReportData(repo, { chatId: "-100", period: "весь период" });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.data.totalAmount, 1599.6, "grand total = SUM(total) БД");
  });

  it("needsReview-чек не смешивается с успешными строками", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "clean", total: 599.6, supplier: "Магнит" }));
    await repo.insert(
      makeDoc({ id: "dirty", total: 7717664244, supplier: "ПОБЕДА", needsReview: true }),
    );

    const built = await buildExpenseReportData(repo, { chatId: "-100" });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.data.items.length, 1, "только чистый чек в items");
    assert.equal(built.data.needsReviewCount, 1, "один чек требует проверки");
    assert.deepEqual(
      built.data.items.map((i) => i.category),
      ["Магнит"],
      "мусорный supplier не в списке",
    );
  });

  it("category длиннее 60 символов → «без категории»", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ supplier: "ООО ".repeat(30).trim(), total: 100 }));
    const built = await buildExpenseReportData(repo, { chatId: "-100" });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.data.items[0].category, "без категории");
  });
});

describe("backfill reparseExpenseFromRaw", () => {
  it("dry-run: отчёт изменений, БД не меняется", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        total: undefined,
        supplier: undefined,
        needsReview: true,
        rawText: "ПОБЕДА ООО\nХлеб 50.00\nИТОГО 6767.00",
      }),
    );

    const dry = reparseExpenseFromRaw(repo, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.scanned, 1);
    assert.ok(dry.changed >= 1, "dry-run фиксирует изменение");
    assert.equal(dry.changes[0].after.total, 6767);

    // БД не изменилась.
    const still = repo.getExpenseById("doc-1")!;
    assert.equal(still.total, undefined);
    assert.equal(still.needsReview, true);
  });

  it("apply: перепарс total/supplier/needsReview из rawText", async () => {
    const repo = makeRepo();
    const y = new Date().getFullYear();
    await repo.insert(
      makeDoc({
        total: undefined,
        supplier: undefined,
        needsReview: true,
        rawText: `МАГНИТ\nХлеб 50.00\nдата ${y}-09-10\nИТОГО 50.00`,
      }),
    );

    const res = reparseExpenseFromRaw(repo, { dryRun: false });
    assert.equal(res.dryRun, false);
    assert.ok(res.changed >= 1);

    const after = repo.getExpenseById("doc-1")!;
    assert.equal(after.total, 50);
    assert.equal(after.supplier, "МАГНИТ");
    assert.equal(after.needsReview, false);
  });

  it("старый doc без rawText не попадает в кандидаты", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: undefined, needsReview: true, rawText: undefined }));
    const res = reparseExpenseFromRaw(repo, { dryRun: true });
    assert.equal(res.scanned, 0, "без raw_text — не перепарсиваем");
  });
});
