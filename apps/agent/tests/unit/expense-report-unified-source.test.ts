/**
 * FIX: единый источник для PDF-отчёта — документы + finance-расходы того же чата,
 * с дедупом по дата+поставщик+сумма и guard от пустого PDF.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { buildExpenseReportAttachment } from "../../src/services/documents/expenseReportTools.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDoc(over: Partial<ExpenseDocument> = {}): ExpenseDocument {
  return {
    id: over.id ?? "doc-1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: "Электрик",
    total: 2437,
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

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unified-src-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

const ctx = { chatId: "-100", userId: "42", chatTitle: "Ремонт" };

describe("buildExpenseReportAttachment — единый источник", () => {
  it("объединяет документы и finance-расходы без дублей", async () => {
    const repo = makeRepo();
    // документ уже есть (как из автоматической обработки фото)
    await repo.insert(makeDoc());
    const financeRows = [
      // дубль уже существующего документа → не должен задваиваться
      { date: "2026-09-10", vendor: "Электрик", amount: 2437, currency: "RUB", category: "материалы" },
      // новый ручной расход → добавляется
      { date: "2026-09-12", vendor: "Грузчик", amount: 1000, currency: "RUB", category: "услуги" },
    ];
    const built = await buildExpenseReportAttachment(
      { dimension: "none" },
      ctx,
      repo,
      financeRows,
    );
    assert.ok(!("error" in built), `unexpected error: ${JSON.stringify(built)}`);
    if ("error" in built) return;
    // 2 уникальных записи: 2437 + 1000
    assert.equal(built.count, 2);
    assert.equal(built.totalAmount, 3437);
  });

  it("пустой результат → ошибка, а не пустой PDF", async () => {
    const repo = makeRepo();
    const built = await buildExpenseReportAttachment(
      { dimension: "none" },
      ctx,
      repo,
      [],
    );
    assert.ok("error" in built, "ожидалась ошибка при отсутствии данных");
    if ("error" in built) {
      assert.match(built.error, /Нет данных для отчёта/);
    }
  });
});
