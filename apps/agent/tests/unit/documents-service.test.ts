import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { DocumentIngestService } from "../../src/services/documents/DocumentIngestService.js";
import type { DocumentExtractor, ExtractorResult } from "../../src/services/documents/extractors/types.js";
import { expensesListHandler, expensesSumHandler } from "../../src/services/documents/expensesTools.js";
import { todayYmd, ymdDaysAgo } from "../../src/services/documents/extractors/parsers.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpPaths: string[] = [];

function makeRepo(): { repo: DocumentsRepository; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  tmpPaths.push(dir);
  return { repo: new DocumentsRepository(path.join(dir, "documents.sqlite")), dir };
}

function doc(overrides: Partial<ExpenseDocument>): ExpenseDocument {
  return {
    id: Math.random().toString(36).slice(2),
    chatId: "-100",
    kind: "receipt",
    docDate: todayYmd(),
    currency: "RUB",
    confidence: 0.5,
    needsReview: false,
    source: "telegram",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  while (tmpPaths.length) {
    fs.rmSync(tmpPaths.pop()!, { recursive: true, force: true });
  }
});

describe("DocumentsRepository", () => {
  it("query без дат — вся история чата (fullHistory)", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ supplier: "Ромашка", total: 100, docDate: "2026-01-01" }));
    await repo.insert(doc({ supplier: "Весна", total: 200, docDate: "2026-08-01" }));

    const r = await repo.query({ chatId: "-100" });
    assert.equal(r.fullHistory, true);
    assert.equal(r.count, 2);
    assert.equal(r.totalSum, 300);
  });

  it("supplier filter без дат — все совпадения по чату", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ supplier: "Ромашка", total: 100 }));
    await repo.insert(doc({ supplier: "ООО Ромашка", total: 50 }));
    await repo.insert(doc({ supplier: "Весна", total: 200 }));

    const r = await repo.query({ chatId: "-100", supplier: "ромашка" });
    assert.equal(r.fullHistory, true);
    assert.equal(r.count, 2);
    assert.equal(r.totalSum, 150);
  });

  it("fromDate/toDate — только диапазон, fullHistory=false", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ total: 10, docDate: "2026-01-05" }));
    await repo.insert(doc({ total: 20, docDate: "2026-03-10" }));
    await repo.insert(doc({ total: 40, docDate: "2026-03-25" }));

    const r = await repo.query({ chatId: "-100", fromDate: "2026-03-01", toDate: "2026-03-20" });
    assert.equal(r.fullHistory, false);
    assert.equal(r.count, 1);
    assert.equal(r.totalSum, 20);

    const full = await repo.query({ chatId: "-100" });
    assert.equal(full.totalSum, 70, "полная сумма ≠ сумма диапазона");
  });

  it("дедуп по file_unique_id: вторая вставка возвращает existing", async () => {
    const { repo } = makeRepo();
    const first = await repo.insert(doc({ fileUniqueId: "uniq-1", supplier: "A", total: 1 }));
    const second = await repo.insert(doc({ fileUniqueId: "uniq-1", supplier: "B", total: 999 }));
    assert.equal(second.id, first.id);
    assert.equal(second.total, 1);
    const r = await repo.query({ chatId: "-100" });
    assert.equal(r.count, 1);
  });

  it("query чужого чата не пересекается", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ chatId: "-100", total: 5 }));
    await repo.insert(doc({ chatId: "-200", total: 7 }));
    assert.equal((await repo.query({ chatId: "-100" })).count, 1);
  });

  it("форумные темы: insert threadId + query по теме и по всему чату", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ threadId: "10", total: 100 }));
    await repo.insert(doc({ threadId: "11", total: 500 }));

    const threadA = await repo.query({ chatId: "-100", threadId: "10" });
    assert.equal(threadA.count, 1);
    assert.equal(threadA.totalSum, 100);

    const whole = await repo.query({ chatId: "-100" });
    assert.equal(whole.count, 2);
    assert.equal(whole.totalSum, 600);
  });
});

describe("DocumentIngestService", () => {
  const fakeExtractor: DocumentExtractor = {
    async extract(input): Promise<ExtractorResult> {
      return {
        kind: "receipt",
        docDate: "2026-09-01",
        supplier: "Ромашка",
        total: 15400,
        currency: "RUB",
        rawText: input.caption,
        confidence: 0.4,
        needsReview: true,
      };
    },
  };

  it("ingest: mock extractor + download → запись в store, temp удалён", async () => {
    const { repo, dir } = makeRepo();
    const svc = new DocumentIngestService(repo, fakeExtractor);
    const temp = path.join(dir, "file-1.pdf");

    const inserted = await svc.ingestFromTelegram(
      {
        chat: { id: -100 },
        from: { id: 42 },
        messageId: 7,
        caption: "чек из Ромашки",
        document: { file_id: "f1", file_unique_id: "u1", file_name: "check.pdf", mime_type: "application/pdf" },
      },
      { download: async () => temp },
    );

    assert.equal(inserted.supplier, "Ромашка");
    assert.equal(inserted.total, 15400);
    assert.equal(inserted.chatId, "-100");
    assert.equal(fs.existsSync(temp), false, "temp-файл удалён");
  });

  it("повторный file_unique_id → нет дубля", async () => {
    const { repo, dir } = makeRepo();
    const svc = new DocumentIngestService(repo, fakeExtractor);
    const msg = {
      chat: { id: -100 },
      document: { file_id: "f1", file_unique_id: "u1", mime_type: "application/pdf" },
    };
    const first = await svc.ingestFromTelegram(msg, {
      download: async () => path.join(dir, "a"),
    });
    const second = await svc.ingestFromTelegram(msg, {
      download: async () => path.join(dir, "b"),
    });
    assert.equal(second.id, first.id);
    assert.equal((await repo.query({ chatId: "-100" })).count, 1);
  });
});

describe("expenses tool handlers", () => {
  it("без дат → fullHistory, сумма по всем записям чата", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ supplier: "Ромашка", total: 100, docDate: ymdDaysAgo(100) }));
    await repo.insert(doc({ supplier: "Ромашка", total: 50, docDate: ymdDaysAgo(1) }));

    const text = await expensesSumHandler(
      { supplier: "Ромашка" },
      { chatId: "-100", userId: "42", canManage: async () => true },
      repo,
    );
    assert.ok(text.includes("вся история чата"));
    assert.ok(text.includes("150"));
  });

  it("period 14d → только недавние записи", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ total: 100, docDate: ymdDaysAgo(100) }));
    await repo.insert(doc({ total: 50, docDate: ymdDaysAgo(2) }));

    const text = await expensesSumHandler(
      { period: "14d" },
      { chatId: "-100", userId: "42", canManage: async () => true },
      repo,
    );
    assert.ok(text.includes("выбранный период"));
    assert.ok(text.includes("50"));
    assert.ok(!text.includes("150"));
  });

  it("пустой store → «Записей ... нет»", async () => {
    const { repo } = makeRepo();
    const text = await expensesSumHandler({}, { chatId: "-100", userId: "42" }, repo);
    assert.ok(text.includes("Записей"));
  });

  it("чужой chatId без canManage → отказ", async () => {
    const { repo } = makeRepo();
    const text = await expensesSumHandler(
      { chatId: "-999" },
      { chatId: "-100", userId: "42", canManage: async () => false },
      repo,
    );
    assert.ok(text.includes("Недостаточно прав"));
  });

  it("expenses_list выводит breakdown", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ supplier: "Ромашка", total: 10, needsReview: true }));
    const text = await expensesListHandler({}, { chatId: "-100", userId: "42" }, repo);
    assert.ok(text.includes("Ромашка"));
    assert.ok(text.includes("(проверка)"));
    assert.ok(text.includes("вся история чата"));
  });

  it("форумные темы: ctx.threadId по умолчанию фильтрует по теме", async () => {
    const { repo } = makeRepo();
    await repo.insert(doc({ threadId: "10", supplier: "Ромашка", total: 100 }));
    await repo.insert(doc({ threadId: "11", supplier: "Ромашка", total: 500 }));

    const inTopic = await expensesSumHandler(
      { supplier: "Ромашка" },
      { chatId: "-100", threadId: "10", userId: "42", canManage: async () => true },
      repo,
    );
    assert.ok(inTopic.includes("100"), "в теме — только 100");
    assert.ok(!inTopic.includes("500"));

    const wholeGroup = await expensesSumHandler(
      { supplier: "Ромашка", scope: "chat" },
      { chatId: "-100", threadId: "10", userId: "42", canManage: async () => true },
      repo,
    );
    assert.ok(wholeGroup.includes("600"), "scope=chat — по всей группе");
  });
});
