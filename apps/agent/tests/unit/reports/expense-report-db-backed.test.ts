/**
 * E3: канонический PDF-путь расходов — данные из БД, не из «пустого объекта LLM».
 *
 * - buildExpenseReportData: repo-строки → ExpenseReportData (тот же источник,
 *   что у текстового эталона expenses_sum);
 * - generate_report(expense-report) с пустым data → наполняется из БД по чату
 *   сессии; БД пуста → ошибка, файла нет;
 * - нет хардкода названий групп/chatId.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExpenseReportData,
  EXPENSE_REPORT_EMPTY_MESSAGE,
} from "../../../src/services/documents/expenseReportTools.js";
import { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../../src/services/documents/types.js";
import { takeSessionFileRecord } from "../../../src/utils/telegram/session-files.js";
import { setSessionContext } from "../../../.pi/extensions/user-rules/context.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { reportType: string; data: Record<string, unknown> },
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  }>;
}

function makeDoc(over: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: "doc-1",
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

const tmpDirs: string[] = [];
let tmpHome = "";

after(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e3-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

const ctx = { sessionManager: { getSessionId: () => "sess-e3" } };

describe("buildExpenseReportData — канонический источник (E3)", () => {
  it("repo-строки → items/categories/totalAmount из факта БД", async () => {
    const repo = makeRepo();
    await repo.insert(makeDoc({}));
    await repo.insert(
      makeDoc({ id: "doc-2", docDate: "2026-09-12", supplier: "Грузчик", total: 1000 }),
    );

    const built = await buildExpenseReportData(repo, {
      chatId: "-100",
      period: "весь период",
    });
    assert.ok(built.ok, "данные построены");
    if (!built.ok) return;
    assert.equal(built.periodLabel, "весь период");
    assert.equal(built.data.totalAmount, 3437);
    assert.equal(built.data.items.length, 2);
    assert.deepEqual(
      built.data.categories.map((c) => c.name).sort(),
      ["Грузчик", "Электрик"],
    );
    assert.deepEqual(
      built.data.items.map((i) => i.amount).sort((a, b) => a - b),
      [1000, 2437],
    );
  });

  it("пустая БД → ошибка «Нет данных...»", async () => {
    const repo = makeRepo();
    const built = await buildExpenseReportData(repo, { chatId: "-100" });
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.error, EXPENSE_REPORT_EMPTY_MESSAGE);
  });

  it("без chatId → ошибка, а не пустой отчёт", async () => {
    const repo = makeRepo();
    const built = await buildExpenseReportData(repo, {});
    assert.equal(built.ok, false);
  });
});

describe("generate_report: пустой data → наполнение из БД (E3)", () => {
  let tool: CapturedTool;

  before(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "e3-home-"));
    process.env.HOME = tmpHome;
    const mod = await import("../../../.pi/extensions/report-generator/index.js");
    const repo = makeRepo();
    await repo.insert(makeDoc({}));
    let captured: CapturedTool | null = null;
    const pi = {
      registerTool: (t: unknown) => {
        const cand = t as CapturedTool;
        if (cand.name === "generate_report") captured = cand;
      },
    } as unknown as ExtensionAPI;
    mod.default(pi, { documentsRepo: repo });
    if (!captured) throw new Error("generate_report не зарегистрирован");
    tool = captured;
  });

  after(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    clearSessionContextForTests();
  });

  function clearSessionContextForTests(): void {
    setSessionContext("sess-e3", undefined);
  }

  it("1. пустой LLM-data + строки в БД → PDF из БД, session-file один раз", async () => {
    setSessionContext("sess-e3", { chatId: "-100", userId: "1" });
    const res = await tool.execute(
      "c1",
      {
        reportType: "expense-report",
        data: { period: "весь период", totalAmount: 0, categories: [], items: [] },
      },
      null,
      null,
      ctx,
    );
    const filePath = res.details?.path;
    assert.equal(typeof filePath, "string", "PDF создан из данных БД");
    assert.ok(res.content[0]!.text!.includes("Report generated:"));

    const record = takeSessionFileRecord("sess-e3");
    assert.ok(record, "session-file зарегистрирован");
    assert.equal(record!.filePath, filePath);
    assert.equal(record!.caption, "Отчёт по расходам за весь период");
    assert.equal(takeSessionFileRecord("sess-e3"), undefined, "ровно одна запись");

    assert.ok(fs.existsSync(filePath as string));
    assert.ok(
      fs.statSync(filePath as string).size > 1000,
      "PDF с данными БД не пустой (>1 КБ; пустой шаблон — ~200 байт)",
    );
  });

  it("2. пустой LLM-data + пустая БД → ошибка, без файла и session-file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e3-empty-"));
    tmpDirs.push(dir);
    const emptyRepo = new DocumentsRepository(path.join(dir, "documents.sqlite"));

    const mod = await import("../../../.pi/extensions/report-generator/index.js");
    let captured: CapturedTool | null = null;
    const pi = {
      registerTool: (t: unknown) => {
        const cand = t as CapturedTool;
        if (cand.name === "generate_report") captured = cand;
      },
    } as unknown as ExtensionAPI;
    mod.default(pi, { documentsRepo: emptyRepo });
    const emptyTool = captured!;

    setSessionContext("sess-e3", { chatId: "-100", userId: "1" });
    const res = await emptyTool.execute(
      "c2",
      {
        reportType: "expense-report",
        data: { period: "весь период", totalAmount: 0, categories: [], items: [] },
      },
      null,
      null,
      ctx,
    );
    assert.equal(res.content[0]!.text, EXPENSE_REPORT_EMPTY_MESSAGE);
    assert.equal(res.details?.error, "EXPENSE_REPORT_EMPTY: no rows and no total");
    assert.equal(takeSessionFileRecord("sess-e3"), undefined);
  });
});

describe("E3: нет хардкода названий групп/чат-айди", () => {
  it("grep: исходники PDF-пути не содержат «ремонт»/«5400»", () => {
    const files = [
      "../../../src/services/documents/expenseReportTools.ts",
      "../../../.pi/extensions/report-generator/index.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(new URL(f, import.meta.url), "utf8").toLowerCase();
      assert.ok(!src.includes("ремонт"), `${f}: нет хардкода названия группы`);
      assert.ok(!src.includes("5400"), `${f}: нет хардкода chatId`);
    }
  });
});
