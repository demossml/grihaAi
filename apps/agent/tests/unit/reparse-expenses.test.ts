/**
 * reparse-expenses backfill: переразбор expense_documents из rawText.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reparseExpenses } from "../../src/services/documents/reparse-expenses.js";
import { parseReceiptFromText } from "../../src/services/documents/extractors/parsers.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reparse-"));
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

describe("parseReceiptFromText (единый parse для intake и backfill)", () => {
  it("ИТОГО 599.60 + ИНН 7717664244 → total 599.60, items без ИНН", () => {
    const text = "ООО ПОБЕДА\nИНН 7717664244\nКАССОВЫЙ ЧЕК\nХлеб 50.00\nИТОГО 599.60";
    const p = parseReceiptFromText(text);
    assert.equal(p.total, 599.6);
    assert.ok(p.items && p.items.length > 0, "есть позиции");
    assert.ok(
      !p.items!.some((i) => i.sum === 7717664244),
      "ИНН не стал суммой позиции",
    );
    assert.ok(!p.items!.some((i) => /ИНН|КАССОВЫЙ ЧЕК|ПОБЕДА/i.test(i.name)), "нет служебных строк");
  });
});

describe("reparseExpenses", () => {
  it("нет rawText → skipped (reason=no_raw_text)", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({ id: "d1", total: undefined, supplier: undefined, needsReview: true, rawText: undefined }),
    );
    const s = await reparseExpenses({}, repo);
    assert.equal(s.scanned, 1);
    assert.equal(s.skipped, 1);
    assert.equal(s.updated, 0);
    assert.equal(s.items[0].action, "skipped");
    assert.equal(s.items[0].reason, "no_raw_text");
  });

  it("dryRun → БД не меняется (update НЕ вызван)", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        id: "d1",
        total: undefined,
        supplier: undefined,
        needsReview: true,
        rawText: "Хлеб 50.00\nИТОГО 599.60",
      }),
    );
    const s = await reparseExpenses({ dryRun: true }, repo);
    assert.equal(s.updated, 1, "dry-run фиксирует «обновился бы»");

    const afterDoc = repo.getExpenseById("d1")!;
    assert.equal(afterDoc.total, undefined, "total не записан");
    assert.equal(afterDoc.needsReview, true, "needsReview не записан");
  });

  it("before == after → unchanged", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        id: "d1",
        total: 599.6,
        supplier: "Магнит",
        needsReview: true, // проблемная (нет даты в OCR) → кандидат, но parse даёт те же значения
        rawText: "Магнит\nИТОГО 599.60",
      }),
    );
    const s = await reparseExpenses({}, repo);
    assert.equal(s.scanned, 1);
    assert.equal(s.unchanged, 1);
    assert.equal(s.updated, 0);
    assert.equal(s.items[0].action, "unchanged");
  });

  it("запись: total/supplier перезаписываются из rawText", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        id: "d1",
        total: undefined,
        supplier: undefined,
        needsReview: true,
        rawText: "Магнит\nХлеб 50.00\nИТОГО 50.00",
      }),
    );
    const s = await reparseExpenses({}, repo);
    assert.equal(s.updated, 1);

    const afterDoc = repo.getExpenseById("d1")!;
    assert.equal(afterDoc.total, 50);
    assert.equal(afterDoc.supplier, "Магнит");
  });

  it("onlyProblematic=false → чистая запись тоже кандидат; chatId фильтр работает", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({ id: "clean", chatId: "-100", total: 599.6, needsReview: false, rawText: "Магнит\nИТОГО 599.60" }),
    );
    await repo.insert(
      makeDoc({ id: "other-chat", chatId: "-200", total: 0, needsReview: true, rawText: "ИТОГО 10.00" }),
    );
    // Фильтр по chatId: только -100.
    const s = await reparseExpenses({ onlyProblematic: false, chatId: "-100" }, repo);
    assert.equal(s.scanned, 1);
    assert.ok(s.items.every((i) => i.chatId === "-100"), "только выбранный чат");
  });
});
