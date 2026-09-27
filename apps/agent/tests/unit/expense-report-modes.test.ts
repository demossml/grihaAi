/**
 * expense-report modes: summary/detailed/item_search + detect helpers.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectItemQuery,
  detectReportMode,
  runExpenseReportDispatch,
} from "../../src/services/documents/expense-report-dispatch.js";
import { buildItemSearchData } from "../../src/services/documents/expenseReportTools.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modes-"));
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

function makeDummyPdf(bytes = 2000): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modes-pdf-"));
  tmpDirs.push(dir);
  const p = path.join(dir, "report.pdf");
  fs.writeFileSync(p, Buffer.alloc(bytes, 0x25));
  return p;
}

describe("detectReportMode", () => {
  it("«кратко» → summary", () => {
    assert.equal(detectReportMode("отчёт кратко"), "summary");
  });
  it("«развёрнуто» → detailed", () => {
    assert.equal(detectReportMode("отчёт развёрнуто с позициями"), "detailed");
  });
  it("«сколько закупали X» → item_search", () => {
    assert.equal(detectReportMode("сколько закупали цемент"), "item_search");
  });
  it("default → detailed", () => {
    assert.equal(detectReportMode("отчёт по расходам"), "detailed");
  });
});

describe("detectItemQuery", () => {
  it("«сколько закупали цемент» → «цемент»", () => {
    assert.equal(detectItemQuery("сколько закупали цемент"), "цемент");
  });
  it("без закупочного маркера → undefined", () => {
    assert.equal(detectItemQuery("отчёт по расходам"), undefined);
  });
});

describe("buildItemSearchData", () => {
  it("выбирает позиции по itemQuery + агрегирует сумму", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        id: "d1",
        total: 5200,
        itemsJson: JSON.stringify([
          { name: "Цемент М500", qty: 10, sum: 5000 },
          { name: "Песок", qty: 2, sum: 200 },
        ]),
      }),
    );
    await repo.insert(
      makeDoc({
        id: "d2",
        total: 2000,
        itemsJson: JSON.stringify([{ name: "Цемент М400", qty: 5, sum: 2000 }]),
      }),
    );
    const built = await buildItemSearchData(repo, { chatId: "-100", itemQuery: "цемент" });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.data.items.length, 2);
    assert.equal(built.data.totalAmount, 7000);
    const descs = built.data.items.map((i) => i.description).sort();
    assert.deepEqual(descs, ["Цемент М400 × 5", "Цемент М500 × 10"]);
  });

  it("совпадений 0 → ok:false с message", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "d1", itemsJson: JSON.stringify([{ name: "Песок", sum: 100 }]) }));
    const built = await buildItemSearchData(repo, { chatId: "-100", itemQuery: "цемент" });
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.match(built.error, /Не найдено позиций/);
  });
});

describe("runExpenseReportDispatch modes", () => {
  it("item_search → ok с PDF, docCount/totalAmount из совпадений", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({ id: "d1", total: 300, itemsJson: JSON.stringify([{ name: "Цемент", qty: 3, sum: 300 }]) }),
    );
    const pdfPath = makeDummyPdf();
    const res = await runExpenseReportDispatch(
      { chatId: "-100", mode: "item_search", itemQuery: "цемент" },
      { repo, renderPdf: async () => pdfPath },
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.docCount, 1);
    assert.equal(res.totalAmount, 300);
  });

  it("detailed → rich (docCount из summary), totalAmount из totalLabel", async () => {
    const repo = makeRepo();
    await repo.insert(
      makeDoc({
        id: "d1",
        total: 100,
        itemsJson: JSON.stringify([{ name: "Хлеб", sum: 50 }, { name: "Молоко", sum: 50 }]),
      }),
    );
    const pdfPath = makeDummyPdf();
    const res = await runExpenseReportDispatch(
      { chatId: "-100", mode: "detailed" },
      { repo, renderPdf: async () => pdfPath },
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.docCount, 1);
    assert.equal(res.totalAmount, 100);
  });

  it("problems → ok:false (без PDF mode)", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: 100 }));
    const res = await runExpenseReportDispatch({ chatId: "-100", mode: "problems" }, { repo });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "EMPTY");
  });
});
