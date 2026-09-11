/**
 * PROMPT 07 — retry/idempotency/crash recovery:
 * stale-processing requeue, transient/permanent, jitter, атомарный дедуп.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MediaRetryQueue,
  isTransientMediaError,
  mediaRetryJitterMs,
} from "../../src/services/documents/media-retry.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeQueue(): MediaRetryQueue {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retry-rel-"));
  tmpDirs.push(dir);
  return new MediaRetryQueue(path.join(dir, "media-retry.sqlite"));
}

describe("transient/permanent классификация", () => {
  it("сетевые ошибки — transient; валидация/лимиты — permanent", () => {
    assert.equal(isTransientMediaError("ECONNRESET"), true);
    assert.equal(isTransientMediaError("ETIMEDOUT"), true);
    assert.equal(isTransientMediaError("Telegram getFile failed: 429"), true);
    assert.equal(isTransientMediaError("Vision API error 502"), true);
    assert.equal(isTransientMediaError("media mime not allowed: application/x-msdownload"), false);
    assert.equal(isTransientMediaError("media too large: 999 > 100 bytes"), false);
    assert.equal(isTransientMediaError("Telegram getFile failed: 404"), false);
    assert.equal(isTransientMediaError("no botToken"), false);
  });
});

describe("MediaRetryQueue crash recovery", () => {
  it("job в processing после crash → requeueStaleProcessing возвращает в pending", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f1", fileUniqueId: "u1", kind: "photo" });
    await q.claimDue(1); // claimed, статус processing — «воркер упал»

    const requeued = await q.requeueStaleProcessing(0); // порог 0 — всё stale
    assert.equal(requeued, 1);
    const [job] = await q.claimDue(1);
    assert.equal(job.status, "processing");
    assert.equal(job.attempts, 1, "attempts учтены после recovery");
    q.close();
  });

  it("исчерпавшие попытки stale-processing → dead (не переисполняются)", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f2", kind: "document" });
    const [job] = await q.claimDue(1);
    for (let i = 0; i < 9; i++) await q.markFailure(job.id, "boom"); // 9 попыток
    const [job9] = await q.claimDue(1);
    await q.requeueStaleProcessing(0);
    assert.equal((await q.claimDue(5)).length, 0, "dead после исчерпания");
    void job9;
    q.close();
  });

  it("markPermanentDead — сразу dead, retry невозможен", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f3", kind: "photo" });
    const [job] = await q.claimDue(1);
    await q.markPermanentDead(job.id, "media mime not allowed");
    assert.equal((await q.claimDue(5)).length, 0);
    q.close();
  });

  it("jitter в границах 0.8..1.2 от bounded backoff", () => {
    for (let i = 0; i < 50; i++) {
      const ms = mediaRetryJitterMs(1); // base 60s
      assert.ok(ms >= 48_000 && ms <= 72_000, `jitter out of bounds: ${ms}`);
    }
    assert.ok(mediaRetryJitterMs(10) <= 3600 * 1000 * 1.2, "потолок сохраняется");
  });
});

describe("idempotency: атомарный дедуп expenses", () => {
  function makeRepo(): DocumentsRepository {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-docs-"));
    tmpDirs.push(dir);
    return new DocumentsRepository(path.join(dir, "documents.sqlite"));
  }

  const doc = (fileUniqueId: string): ExpenseDocument => ({
    id: Math.random().toString(36).slice(2),
    chatId: "-100",
    kind: "receipt",
    docDate: "2026-09-11",
    total: 10,
    currency: "RUB",
    confidence: 0.5,
    needsReview: false,
    source: "telegram",
    fileUniqueId,
    fileId: `f-${fileUniqueId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it("одновременная двойная вставка одного file_unique_id → одна строка", async () => {
    const repo = makeRepo();
    const [a, b] = await Promise.all([
      repo.insert(doc("uniq-race")),
      repo.insert(doc("uniq-race")),
    ]);
    assert.equal(a.id, b.id, "оба вызова вернули одну и ту же запись");
    assert.equal((await repo.query({ chatId: "-100" })).count, 1);
  });

  it("повторный апдейт не создаёт вторую запись (archive + expense)", async () => {
    const repo = makeRepo();
    const first = await repo.insert(doc("uniq-1"));
    const second = await repo.insert(doc("uniq-1"));
    assert.equal(first.id, second.id);
  });
});
