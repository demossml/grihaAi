/**
 * D5: адаптер DocumentsRepository → ExpensesReader (report-data).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../../src/services/documents/types.js";
import { createDocumentsExpensesReader } from "../../../src/services/documents/reportDataAdapter.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d5-repo-"));
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
    confidence: 0.9,
    needsReview: false,
    source: "telegram",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("createDocumentsExpensesReader (D5)", () => {
  it("маппит полные строки в ExpenseRow (rawText/itemsJson/messageId/kind)", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        messageId: "42",
        rawText: "чек магазин",
        itemsJson: JSON.stringify([{ name: "Кабель", qty: 45, sum: 178 }]),
        confidence: 0.4,
        needsReview: true,
        fileName: "r1.jpg",
      }),
    );

    const reader = createDocumentsExpensesReader(repo);
    const rows = await reader.listExpenses({ chatId: "-100", limit: 100 });

    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.id, "doc-1");
    assert.equal(r.chatId, "-100");
    assert.equal(r.messageId, "42");
    assert.equal(r.supplier, "Магнит");
    assert.equal(r.total, 507.99);
    assert.equal(r.currency, "RUB");
    assert.equal(r.rawText, "чек магазин");
    assert.equal(r.itemsJson, JSON.stringify([{ name: "Кабель", qty: 45, sum: 178 }]));
    assert.equal(r.confidence, 0.4);
    assert.equal(r.needsReview, true);
    assert.equal(r.fileName, "r1.jpg");
    assert.equal(r.kind, "receipt");
  });

  it("пустой чат → []", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ chatId: "-200" }));
    const reader = createDocumentsExpensesReader(repo);
    const rows = await reader.listExpenses({ chatId: "-100", limit: 100 });
    assert.equal(rows.length, 0);
  });
});
