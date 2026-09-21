/**
 * document_fill — дозаполнение проблемных чеков (service level, temp sqlite).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";
import { fillExpenseDocumentService, validatePatch } from "../../src/services/documents/documentFill.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fill-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "e1",
    chatId: "-100",
    docDate: "2026-09-10",
    supplier: undefined,
    total: 100,
    currency: "RUB",
    kind: "receipt",
    confidence: 0.4,
    needsReview: true,
    rawText: "чек",
    source: "telegram",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("fillExpenseDocumentService", () => {
  it("fill total+supplier на проблемной строке → needs_review очищен", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1", total: undefined, needsReview: true }));

    const r = await fillExpenseDocumentService(
      { expenseId: "e1", total: 100, supplier: "X" },
      { repo, expectedChatId: "-100" },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.after.needsReview, false);
    assert.equal(r.after.total, 100);
    assert.equal(r.after.supplier, "X");
  });

  it("неизвестный id → NOT_FOUND", async () => {
    const repo = makeRepo();
    const r = await fillExpenseDocumentService(
      { expenseId: "nope", total: 100 },
      { repo, expectedChatId: "-100" },
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "NOT_FOUND");
  });

  it("документ другого чата → CHAT_MISMATCH", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1", chatId: "-100" }));

    const r = await fillExpenseDocumentService(
      { expenseId: "e1", total: 100 },
      { repo, expectedChatId: "-200" },
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "CHAT_MISMATCH");
  });

  it("пустой patch → INVALID_INPUT", async () => {
    assert.equal(validatePatch({ expenseId: "e1" }), "Нет полей для обновления");
  });

  it("плохой docDate → INVALID_INPUT", async () => {
    assert.equal(validatePatch({ expenseId: "e1", docDate: "2026-9-1" }), "docDate должен быть YYYY-MM-DD");
  });

  it("items записываются в items_json (парсится обратно)", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1" }));

    const r = await fillExpenseDocumentService(
      { expenseId: "e1", items: [{ name: "болт", qty: 2, sum: 10 }] },
      { repo, expectedChatId: "-100" },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const after = repo.getExpenseById("e1")!;
    const items = JSON.parse(after.itemsJson!);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "болт");
    assert.equal(items[0].qty, 2);
  });

  it("note дописывает [manual в raw_text", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "e1", rawText: "исходный" }));

    const r = await fillExpenseDocumentService(
      { expenseId: "e1", note: "проверено" },
      { repo, expectedChatId: "-100" },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const after = repo.getExpenseById("e1")!;
    assert.ok(after.rawText!.includes("[manual"), after.rawText ?? "");
    assert.ok(after.rawText!.includes("исходный"));
  });
});
