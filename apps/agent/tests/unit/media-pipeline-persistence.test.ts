/**
 * PROMPT 04/05 — единый media pipeline: photo/document/voice с постоянным
 * хранилищем, caption отдельно, дубликаты, STT-failure.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ListenerMediaPipeline } from "../../src/services/documents/ListenerMediaPipeline.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { LocalMediaStorage } from "../../src/services/documents/media-storage.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
const tmpFiles: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop()!, { force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-pipe-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeStorage(): LocalMediaStorage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-store-"));
  tmpDirs.push(dir);
  return new LocalMediaStorage({ rootDir: dir });
}

function makeFile(name: string, content = "bytes"): string {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpFiles.push(file);
  fs.writeFileSync(file, content);
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

const okStt = async () => ({ ok: true, text: "завтра встреча в десять утра" });
const failStt = async () => ({ ok: false, text: "", error: "STT down" });

describe("media pipeline: фото с постоянным хранилищем", () => {
  it("photo: файл остаётся в storage, telegram_media-строка создана, caption отдельно", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("p", "jpeg-content");
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => file, { storage });

    const res = await pipeline.process({
      chatId: "-100",
      messageId: "7",
      caption: "чек из магазина",
      photo: [{ file_id: "p1", file_unique_id: "pu1" }],
    });

    assert.equal(res.archived, true);
    assert.equal(res.ingestedExpense, true);
    const media = repo.findMediaByFileUniqueId("-100", "pu1");
    assert.ok(media, "telegram_media-запись есть");
    assert.equal(media!.processingStatus, "processed");
    assert.equal(media!.caption, "чек из магазина", "caption сохранён отдельно");
    assert.ok(await storage.exists(media!.storageKey), "физический файл пережил обработку");
    const archive = repo.findArchiveByFileUniqueId("-100", "pu1");
    assert.ok(archive);
    assert.equal(archive!.caption, "чек из магазина");
    assert.equal(archive!.rawText, "поставщик X 100 RUB", "OCR-текст без примеси caption");
  });

  it("дубликат фото: повторный process → без нового скачивания, один файл и одна запись", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("p2", "jpeg-content-2");
    let downloads = 0;
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => {
      downloads++;
      return file;
    }, { storage });

    const input = {
      chatId: "-100",
      messageId: "8",
      photo: [{ file_id: "p2", file_unique_id: "pu2" }],
    };
    await pipeline.process(input);
    await pipeline.process(input);

    assert.equal(downloads, 1, "reuse сохранённого файла, повторное скачивание не нужно");
    assert.equal(repo.countArchive("-100"), 1);
    const media = repo.findMediaByFileUniqueId("-100", "pu2");
    assert.ok(media);
    const files = fs.readdirSync(storage.root, { recursive: true }).filter((f) => String(f).includes("."));
    assert.equal(files.length, 1, "один физический файл");
  });

  it("OCR failure → файл остаётся, статус failed, архив с needsReview", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("p3", "jpeg-3");
    const failing: DocumentExtractor = {
      async extract() {
        return { kind: "unknown", confidence: 0.1, needsReview: true };
      },
    };
    const pipeline = new ListenerMediaPipeline(repo, failing, async () => file, { storage });

    const res = await pipeline.process({
      chatId: "-100",
      messageId: "9",
      photo: [{ file_id: "p3", file_unique_id: "pu3" }],
    });
    const media = repo.findMediaByFileUniqueId("-100", "pu3");
    assert.equal(media!.processingStatus, "failed");
    assert.ok(await storage.exists(media!.storageKey), "единственная копия не удаляется");
    assert.equal(res.needsReview, true);
  });
});

describe("media pipeline: voice (STT + архив)", () => {
  const voiceInput = {
    chatId: "-100",
    threadId: "15",
    messageId: "10",
    fromUserId: "42",
    voice: { file_id: "v1", file_unique_id: "vu1", duration: 5, mime_type: "audio/ogg" },
  };

  it("voice success: STT + архив kind=voice, expense-строки НЕТ", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("v", "ogg-bytes");
    let sttCalls = 0;
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => file, {
      storage,
      stt: async () => {
        sttCalls++;
        return okStt();
      },
    });

    const res = await pipeline.process(voiceInput);
    assert.equal(sttCalls, 1);
    assert.equal(res.archived, true);
    assert.equal(res.rawText, "завтра встреча в десять утра");
    assert.equal(res.ingestedExpense, false, "voice не становится expense");
    const archive = repo.findArchiveByFileUniqueId("-100", "vu1");
    assert.equal(archive!.kind, "voice");
    assert.equal(archive!.rawText, "завтра встреча в десять утра");
    assert.ok(archive!.confidence >= 0.9, "assessTranscriptConfidence подключён");
    const media = repo.findMediaByFileUniqueId("-100", "vu1");
    assert.equal(media!.processingStatus, "processed");
    assert.ok(await storage.exists(media!.storageKey));
  });

  it("voice STT failure → файл сохранён, архив needsReview, статус failed", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("v2", "ogg-2");
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => file, {
      storage,
      stt: failStt,
    });

    const res = await pipeline.process(voiceInput);
    const archive = repo.findArchiveByFileUniqueId("-100", "vu1");
    assert.equal(archive!.kind, "voice");
    assert.equal(archive!.rawText, undefined);
    assert.equal(archive!.needsReview, true);
    assert.equal(archive!.ocrStatus, "failed");
    const media = repo.findMediaByFileUniqueId("-100", "vu1");
    assert.equal(media!.processingStatus, "failed", "extraction пустой → failed");
    assert.ok(await storage.exists(media!.storageKey), "файл остаётся");
    assert.equal(res.needsReview, true);
  });

  it("voice без STT-зависимости → needsReview, не падает", async () => {
    const repo = makeRepo();
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => makeFile("v3"), {});
    const res = await pipeline.process(voiceInput);
    assert.equal(res.needsReview, true);
    assert.equal(res.rawText, undefined);
  });

  it("ретрай-жоб voice → jobToListenerInput даёт voice-ветку", async () => {
    const { jobToListenerInput } = await import(
      "../../src/services/documents/ListenerMediaPipeline.js"
    );
    const input = jobToListenerInput({
      id: "j1",
      chatId: "-100",
      fileId: "v9",
      fileUniqueId: "vu9",
      kind: "voice",
      attempts: 0,
      maxAttempts: 10,
      nextAttemptAt: "t",
      status: "pending",
      createdAt: "t",
      updatedAt: "t",
    });
    assert.deepEqual(input.voice, { file_id: "v9", file_unique_id: "vu9" });
  });
});

describe("media pipeline: document", () => {
  it("document: файл сохраняется, OCR применяется, expense только для подходящего", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const file = makeFile("d", "pdf-bytes");
    const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => file, { storage });

    const res = await pipeline.process({
      chatId: "-100",
      messageId: "11",
      document: { file_id: "d1", file_unique_id: "du1", file_name: "check.pdf", mime_type: "application/pdf" },
    });
    const archive = repo.findArchiveByFileUniqueId("-100", "du1");
    assert.equal(archive!.kind, "expense");
    assert.equal(res.ingestedExpense, true);
    const media = repo.findMediaByFileUniqueId("-100", "du1");
    assert.ok(await storage.exists(media!.storageKey));
  });
});
