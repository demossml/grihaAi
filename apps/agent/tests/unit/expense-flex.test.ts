/**
 * Expense flexibility (F1–F7): миграция, классификация, исправление+обучение,
 * разрезы отчёта, дедуп, поиск. Без хардкода доменов.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";
import {
  classifyExpense,
  hintsToLines,
  memoryHintMatch,
} from "../../src/services/documents/classify-expense.js";
import {
  groupReportRows,
  expenseUpdateHandler,
  expensesSearchHandler,
  keywordFromNote,
  markReportSent,
  sumLineItemQty,
  wasReportRecentlySent,
} from "../../src/services/documents/expenseReportTools.js";
import { ListenerMediaPipeline } from "../../src/services/documents/ListenerMediaPipeline.js";
import type { DocumentExtractor, ExtractorResult } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-flex-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

const doc = (over: Partial<ExpenseDocument> & { id: string; chatId: string }): ExpenseDocument => ({
  kind: "receipt",
  docDate: "2026-09-01",
  currency: "RUB",
  confidence: 1,
  needsReview: false,
  source: "telegram",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

// ── 1: миграция открывает старую БД ────────────────────────────────────────

describe("миграция flex-колонок", () => {
  it("старая схема (без category/tags/line_items) открывается и дополняется", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-old-"));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, "documents.sqlite");
    const raw = new Database(dbPath);
    // Схема ДО flex-патча: все старые колонки, без category/tags/line_items/attrs.
    raw.exec(`CREATE TABLE expense_documents (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, thread_id TEXT, message_id TEXT,
      from_user_id TEXT, file_id TEXT, file_unique_id TEXT, file_name TEXT, mime_type TEXT,
      kind TEXT NOT NULL DEFAULT 'unknown', doc_date TEXT NOT NULL, supplier TEXT,
      total REAL, currency TEXT NOT NULL DEFAULT 'RUB', raw_text TEXT, items_json TEXT,
      confidence REAL NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'telegram', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    raw.close();

    const repo = new DocumentsRepository(dbPath);
    await repo.insert(doc({ id: "x1", chatId: "-100" }));
    const stored = await repo.getById("x1");
    assert.ok(stored);
    const cols = new Set(
      (new Database(dbPath).pragma("table_info(expense_documents)") as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const c of ["category", "tags", "line_items", "attrs"]) {
      assert.ok(cols.has(c), `колонка ${c} должна добавиться миграцией`);
    }
  });
});

// ── 2: ingest сохраняет категорию из mock-классификатора ──────────────────

describe("ingest сохраняет category/line_items (F2/F3)", () => {
  it("mock classifyExpense → категория и позиции в БД", async () => {
    const repo = makeRepo();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp-ing-"));
    tmpDirs.push(tmp);
    const filePath = path.join(tmp, "receipt.jpg");
    fs.writeFileSync(filePath, "fake");

    const extractor: DocumentExtractor = {
      async extract(): Promise<ExtractorResult> {
        return {
          kind: "receipt",
          docDate: "2026-09-01",
          supplier: "ЭлектрикПрофи",
          total: 2437,
          currency: "RUB",
          rawText: "кабель ВВГ 2x1.5 100 м\nИТОГ 2437",
          confidence: 0.85,
          needsReview: false,
        };
      },
    };

    const pipeline = new ListenerMediaPipeline(
      repo,
      extractor,
      async () => filePath,
      {
        classifyExpense: async () => ({
          category: "кабель",
          lineItems: [{ name: "ВВГ 2x1.5", qty: 100, unit: "м", amount: 2437 }],
        }),
      },
    );

    const res = await pipeline.process({
      chatId: "-100",
      messageId: "10",
      photo: [{ file_id: "f1", file_unique_id: "fu1" }],
    });
    assert.equal(res.ingestedExpense, true);
    const stored = (await repo.findByFileUniqueId("-100", "fu1"))!;
    assert.equal(stored.category, "кабель");
    assert.equal(stored.lineItems?.[0]?.unit, "м");
  });
});

// ── 3/4: expense_update + chat-scoped обучение ─────────────────────────────

describe("expense_update + learning (F4)", () => {
  it("меняет категорию и пишет supplier→category правило для чата", async () => {
    const repo = makeRepo();
    await repo.insert(
      doc({ id: "e1", chatId: "-100", supplier: "ЭлектрикПрофи", total: 2437 }),
    );
    const out = await expenseUpdateHandler(
      { expenseId: "e1", category: "электрика" },
      { chatId: "-100" },
      repo,
    );
    assert.ok(out.includes("электрика"));
    const updated = await repo.getById("e1");
    assert.equal(updated?.category, "электрика");
    const hints = repo.listExpenseLearning("-100");
    assert.ok(
      hints.some((h) => h.patternType === "supplier" && h.pattern === "ЭлектрикПрофи" && h.category === "электрика"),
    );
  });

  it("следующая классификация по тому же поставщику берёт категорию из памяти", () => {
    const hints = [
      { patternType: "supplier", pattern: "ЭлектрикПрофи", category: "электрика" },
    ];
    assert.equal(
      memoryHintMatch({ supplier: "ЭлектрикПрофи", rawText: "кабель" }, hints),
      "электрика",
    );
    assert.equal(
      memoryHintMatch({ supplier: "Другой", rawText: "болты" }, hints),
      undefined,
    );
    assert.ok(hintsToLines(hints)[0].includes("электрика"));
  });

  it("keyword из примечания «по слову»", () => {
    assert.equal(keywordFromNote("по слову «ВВГ»"), "ввг");
    assert.equal(keywordFromNote("просто запомни"), undefined);
  });
});

// ── 5: разрезы отчёта с под-итогами ───────────────────────────────────────

describe("groupReportRows (F5)", () => {
  const rows = [
    { date: "2026-09-01", supplier: "A", total: 100, currency: "RUB", needsReview: false, category: "материалы" },
    { date: "2026-09-02", supplier: "B", total: 200, currency: "RUB", needsReview: false, category: "услуги" },
    { date: "2026-09-03", supplier: "C", total: 50, currency: "RUB", needsReview: false, category: "материалы" },
  ];

  it("dimension=category → секции, под-итоги = суммы строк", () => {
    const { sections } = groupReportRows(rows, "category", undefined);
    assert.equal(sections.length, 2);
    const materials = sections.find((s) => s.label === "материалы")!;
    assert.equal(materials.subtotal, 150);
    const services = sections.find((s) => s.label === "услуги")!;
    assert.equal(services.subtotal, 200);
  });

  it("dimension=supplier → секции по поставщикам; filterValue оставляет одну", () => {
    const all = groupReportRows(rows, "supplier", undefined);
    assert.equal(all.sections.length, 3);
    const one = groupReportRows(rows, "supplier", "A");
    assert.equal(one.sections.length, 1);
    assert.equal(one.sections[0].subtotal, 100);
  });

  it("неизвестный разрез → ошибка, не enum-схема", () => {
    const { error } = groupReportRows(rows, "стройка", undefined);
    assert.ok(error?.includes("Неизвестный разрез"));
  });

  it("сумма по всем секциям = сумме строк", () => {
    const { sections } = groupReportRows(rows, "category", undefined);
    const total = sections.reduce((a, s) => a + s.subtotal, 0);
    assert.equal(total, 350);
  });
});

// ── 6: дедуп отчёта ────────────────────────────────────────────────────────

describe("report dedupe (10 минут)", () => {
  it("повторный ключ в окне → подавлен, другой ключ — нет", () => {
    assert.equal(wasReportRecentlySent("k1"), false);
    markReportSent("k1");
    assert.equal(wasReportRecentlySent("k1"), true);
    assert.equal(wasReportRecentlySent("k2"), false);
  });
});

// ── 6: гибкий поиск и агрегация позиций ───────────────────────────────────

describe("expenses_search (F6)", () => {
  it("ищет по raw_text и агрегирует qty по единицам", async () => {
    const repo = makeRepo();
    await repo.insert(
      doc({
        id: "e1",
        chatId: "-100",
        supplier: "ЭлектрикПрофи",
        total: 2437,
        rawText: "кабель ВВГ 2x1.5 100 м",
        lineItems: [{ name: "кабель ВВГ 2x1.5", qty: 100, unit: "м" }],
      }),
    );
    const out = await expensesSearchHandler(
      { query: "кабель" },
      { chatId: "-100" },
      repo,
    );
    assert.ok(out.includes("Найдено записей: 1"));
    assert.ok(out.includes("100 м"), out);
    assert.equal(sumLineItemQty([{ name: "ВВГ", qty: 100, unit: "м" }], "ввг", "м"), 100);
  });

  it("нет позиций → честный ответ с фрагментами", async () => {
    const repo = makeRepo();
    await repo.insert(doc({ id: "e1", chatId: "-100", rawText: "болты м6 200 шт" }));
    const out = await expensesSearchHandler({ query: "болты" }, { chatId: "-100" }, repo);
    assert.ok(out.includes("не структурированы"), out);
    assert.ok(out.includes("болты м6 200 шт"), out);
  });
});

// ── classifyExpense: LLM mock + сбой → честный null ────────────────────────

describe("classifyExpense (F3)", () => {
  it("LLM JSON → категория и позиции", async () => {
    const res = await classifyExpense(
      { chatId: "-100", rawText: "кабель 50 м", supplier: "X", memoryHints: [] },
      {
        llm: async () =>
          JSON.stringify({
            category: "кабель",
            line_items: [{ name: "ВВГ", qty: 50, unit: "м" }],
          }),
      },
    );
    assert.equal(res.category, "кабель");
    assert.equal(res.lineItems?.[0].qty, 50);
  });

  it("сбой LLM → пустой результат, не падает", async () => {
    const res = await classifyExpense(
      { chatId: "-100", rawText: "x", memoryHints: [] },
      {
        llm: async () => {
          throw new Error("api down");
        },
      },
    );
    assert.deepEqual(res, {});
  });
});
