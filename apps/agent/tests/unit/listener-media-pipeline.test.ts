import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ListenerMediaPipeline,
  jobToListenerInput,
  processMediaRetryJob,
  type ListenerMediaProcessFn,
} from "../../src/services/documents/ListenerMediaPipeline.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";
import type { MediaRetryJob } from "../../src/services/documents/media-retry.js";

const tmpDirs: string[] = [];
const tmpFiles: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop()!, { force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-media-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeFile(name: string): string {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpFiles.push(file);
  fs.writeFileSync(file, "bytes");
  return file;
}

const receiptExtractor: DocumentExtractor = {
  async extract() {
    return {
      kind: "receipt",
      docDate: "2026-09-01",
      supplier: "X",
      total: 100,
      currency: "RUB",
      rawText: "поставщик X 100 RUB",
      confidence: 0.7,
      needsReview: false,
    };
  },
};

const emptyExtractor: DocumentExtractor = {
  async extract() {
    return { kind: "unknown", confidence: 0.1, needsReview: true };
  },
};

const input = {
  chatId: "-100",
  threadId: "15",
  messageId: "7",
  fromUserId: "42",
  caption: "чек",
  photo: [{ file_id: "p1", file_unique_id: "pu1" }],
};

describe("ListenerMediaPipeline (listen-only OCR)", () => {
  it("extractor total=100 supplier=X → expense + archive (одно скачивание)", async () => {
    const repo = makeRepo();
    const file = makeFile("lm");
    let downloads = 0;
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => {
      downloads++;
      return file;
    });
    const res = await pipeline.process(input);
    assert.equal(res.archived, true);
    assert.equal(res.ingestedExpense, true);
    assert.equal(res.confidence, 0.7);
    assert.equal(downloads, 1);
    assert.equal(repo.countArchive("-100"), 1);
    const expense = await repo.findByFileUniqueId("-100", "pu1");
    assert.ok(expense, "строка в expense_documents");
    assert.equal(expense!.total, 100);
    assert.equal(expense!.supplier, "X");
    assert.equal(expense!.threadId, "15", "L9: thread_id сохранён");
  });

  it("extractor пустой → archive с needsReview, expense-строки НЕТ", async () => {
    const repo = makeRepo();
    const pipeline = new ListenerMediaPipeline(repo, emptyExtractor, async () => makeFile("lm"));
    const res = await pipeline.process(input);
    assert.equal(res.archived, true);
    assert.equal(res.ingestedExpense, false);
    assert.equal(res.needsReview, true);
    assert.equal(repo.countArchive("-100"), 1);
    assert.equal(await repo.findByFileUniqueId("-100", "pu1"), null);
  });

  it("повторный process с тем же file_unique_id → expense не дублируется", async () => {
    const repo = makeRepo();
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => makeFile("lm"));
    await pipeline.process(input);
    await pipeline.process(input);
    assert.equal(repo.countArchive("-100"), 1, "archive дедуп");
    const expenses = await repo.query({ chatId: "-100" });
    assert.equal(expenses.count, 1, "expense дедуп по file_unique_id");
  });

  it("download throw → ошибка пробрасывается наружу (caller ставит retry)", async () => {
    const repo = makeRepo();
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => {
      throw new Error("ECONNRESET");
    });
    await assert.rejects(() => pipeline.process(input), /ECONNRESET/);
    assert.equal(repo.countArchive("-100"), 0);
  });
});

describe("worker full pipeline (L6)", () => {
  it("processMediaRetryJob вызывает pipeline.process (не archive-only)", async () => {
    const calls: number[] = [];
    const mockPipeline: ListenerMediaProcessFn = {
      async process() {
        calls.push(1);
        return { archived: true, ingestedExpense: false, confidence: 0, needsReview: true };
      },
    };
    const job: MediaRetryJob = {
      id: "j1",
      chatId: "-100",
      threadId: "15",
      messageId: "7",
      fileId: "p1",
      fileUniqueId: "pu1",
      kind: "photo",
      attempts: 1,
      maxAttempts: 10,
      nextAttemptAt: new Date().toISOString(),
      status: "processing",
      createdAt: "t",
      updatedAt: "t",
    };
    await processMediaRetryJob(job, mockPipeline);
    assert.equal(calls.length, 1);
    const input2 = jobToListenerInput(job);
    assert.equal(input2.chatId, "-100");
    assert.deepEqual(input2.photo, [{ file_id: "p1", file_unique_id: "pu1" }]);
  });
});
