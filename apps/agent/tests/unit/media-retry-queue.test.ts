import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MediaRetryQueue,
  mediaRetryBackoffSeconds,
} from "../../src/services/documents/media-retry.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeQueue(): MediaRetryQueue {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-retry-"));
  tmpDirs.push(dir);
  return new MediaRetryQueue(path.join(dir, "media-retry.sqlite"));
}

describe("MediaRetryQueue (R-GR-7)", () => {
  it("enqueue + claimDue возвращает job и помечает processing", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f1", fileUniqueId: "u1", kind: "photo" });
    const jobs = await q.claimDue(5);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "processing");
    assert.equal(jobs[0].fileId, "f1");
    assert.equal(jobs[0].chatId, "-100");
    // Повторный claim не вернёт processing-job.
    assert.equal((await q.claimDue(5)).length, 0);
    q.close();
  });

  it("дедуп: повторный enqueue того же file_unique_id не дублирует", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f1", fileUniqueId: "u1", kind: "photo" });
    await q.enqueue({ chatId: -100, fileId: "f1", fileUniqueId: "u1", kind: "photo" });
    assert.equal((await q.claimDue(5)).length, 1);
    q.close();
  });

  it("markFailure: attempts++ и next_attempt_at в будущем (backoff)", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f2", kind: "document" });
    const [job] = await q.claimDue(1);
    await q.markFailure(job.id, "ECONNRESET");

    const pending = await q.claimDue(1);
    assert.equal(pending.length, 0, "не досрочно");
    // Проверяем backoff-формулу отдельно.
    const seconds = mediaRetryBackoffSeconds(1);
    assert.equal(seconds, 60, "30 * 2^1 = 60");
    assert.equal(mediaRetryBackoffSeconds(10), 3600, "потолок 3600");
    q.close();
  });

  it("markDone снимает job; после max_attempts — dead", async () => {
    const q = makeQueue();
    await q.enqueue({ chatId: -100, fileId: "f3", kind: "photo" });
    const [job] = await q.claimDue(1);
    await q.markDone(job.id);
    assert.equal((await q.claimDue(1)).length, 0);

    await q.enqueue({ chatId: -200, fileId: "f4", kind: "photo" });
    const [job2] = await q.claimDue(1);
    // Доводим до maxAttempts через markFailure: attempts уже 1 → до 10.
    for (let i = 0; i < 20; i++) {
      await q.markFailure(job2.id, `fail ${i}`);
    }
    const [row] = await q.claimDue(10);
    assert.equal(row, undefined, "dead-жобы не переисполняются");
    q.close();
  });
});
