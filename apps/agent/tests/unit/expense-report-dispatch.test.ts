/**
 * expense-report-dispatch: детерминированный PDF из БД (без LLM).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initObs, resetObsForTests } from "@griha/observability";
import type { ObsEvent, ObsSink } from "@griha/observability";
import {
  assertSendablePdf,
  runExpenseReportDispatch,
} from "../../src/services/documents/expense-report-dispatch.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetObsForTests();
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-"));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-pdf-"));
  tmpDirs.push(dir);
  const p = path.join(dir, "report.pdf");
  fs.writeFileSync(p, Buffer.alloc(bytes, 0x25));
  return p;
}

describe("runExpenseReportDispatch", () => {
  it("2 docs (нормализованный supplier) → ok, filePath существует, totals из БД", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "a", supplier: "МАГНИТ", total: 100 }));
    await repo.insert(makeDoc({ id: "b", supplier: "М МАГНИТ", total: 200 }));

    const pdfPath = makeDummyPdf();
    const res = await runExpenseReportDispatch(
      { chatId: "-100" },
      { repo, renderPdf: async () => pdfPath },
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.filePath, pdfPath);
    assert.ok(fs.existsSync(res.filePath), "файл существует");
    assert.equal(res.totalAmount, 300, "итог из БД (SUM total)");
    assert.equal(res.docCount, 2);
  });

  it("emit report.build_data/render_pdf фазы (docCount/totalAmount, без сырого текста)", async () => {
    const captured: ObsEvent[] = [];
    const sink: ObsSink = { write(e) { captured.push(e); } };
    delete process.env.GRIHA_OBS;
    resetObsForTests();
    initObs({ sink });

    const repo = makeRepo();
    await repo.insert(makeDoc({ id: "a", supplier: "Магнит", total: 100 }));
    const pdfPath = makeDummyPdf();
    const res = await runExpenseReportDispatch({ chatId: "-100" }, { repo, renderPdf: async () => pdfPath });
    assert.equal(res.ok, true);

    const buildEnd = captured.find(
      (e) => e.event === "report.build_data" && (e.data as Record<string, unknown>).phase === "end",
    );
    assert.ok(buildEnd, "build_data end есть");
    const bd = buildEnd.data as Record<string, unknown>;
    assert.equal(bd.docCount, 1);
    assert.equal(bd.totalAmount, 100);
    assert.ok(!("rawText" in bd), "нет сырого текста в data");

    const renderEnd = captured.find(
      (e) => e.event === "report.render_pdf" && (e.data as Record<string, unknown>).phase === "end",
    );
    assert.ok(renderEnd, "render_pdf end есть");
    const rd = renderEnd.data as Record<string, unknown>;
    assert.equal(rd.pdfPathExists, true);
    assert.equal(typeof rd.pdfBytes, "number");
    assert.equal(typeof rd.pdfBasename, "string");
    resetObsForTests();
  });

  it("пустая БД → ok:false EMPTY", async () => {
    const repo = makeRepo();
    const res = await runExpenseReportDispatch({ chatId: "-100" }, { repo });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "EMPTY");
  });

  it("render падает → ok:false RENDER_FAILED, без throw", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: 100 }));
    const res = await runExpenseReportDispatch(
      { chatId: "-100" },
      { repo, renderPdf: async () => { throw new Error("boom"); } },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "RENDER_FAILED");
  });

  it("render вернул несуществующий путь → ok:false WRITE_FAILED", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: 100 }));
    const res = await runExpenseReportDispatch(
      { chatId: "-100" },
      { repo, renderPdf: async () => "/no/such/report.pdf" },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "WRITE_FAILED");
  });

  it("canRead false → ACCESS_DENIED", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({ total: 100 }));
    const res = await runExpenseReportDispatch(
      { chatId: "-100", userId: "1" },
      { repo, canRead: async () => false },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "ACCESS_DENIED");
  });
});

describe("assertSendablePdf", () => {
  it("пустой путь → throw PDF_PATH_MISSING", () => {
    assert.throws(() => assertSendablePdf(""), /PDF_PATH_MISSING/);
  });

  it("несуществующий файл → throw PDF_PATH_NOT_FOUND", () => {
    assert.throws(() => assertSendablePdf("/no/such/file.pdf"), /PDF_PATH_NOT_FOUND/);
  });

  it("слишком маленький файл → throw PDF_TOO_SMALL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-tiny-"));
    tmpDirs.push(dir);
    const p = path.join(dir, "tiny.pdf");
    fs.writeFileSync(p, Buffer.alloc(10));
    assert.throws(() => assertSendablePdf(p), /PDF_TOO_SMALL/);
  });

  it("валидный файл → не бросает", () => {
    const p = makeDummyPdf(2000);
    assert.doesNotThrow(() => assertSendablePdf(p));
  });
});
