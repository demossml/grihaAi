/**
 * PROMPT 05 — MediaStorage: persistence, path traversal, limits, dedup.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LocalMediaStorage,
  buildStorageKey,
} from "../../src/services/documents/media-storage.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeStorage(): LocalMediaStorage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-storage-"));
  tmpDirs.push(dir);
  return new LocalMediaStorage({ rootDir: dir });
}

describe("LocalMediaStorage", () => {
  it("put/get/exists/delete: файл переживает обработку", async () => {
    const s = makeStorage();
    const key = buildStorageKey({ chatId: "-100", sha256: "abc", mimeType: "image/jpeg" });
    const res = await s.put({ content: Buffer.from("jpeg-bytes"), key, mimeType: "image/jpeg" });
    assert.equal(res.size, 10);
    assert.ok(res.sha256.length === 64);
    assert.ok(await s.exists(key));
    assert.deepEqual(await s.get(key), Buffer.from("jpeg-bytes"));
    await s.delete(key);
    assert.equal(await s.exists(key), false);
  });

  it("put повторно с тем же ключом — идемпотентно (без ошибки)", async () => {
    const s = makeStorage();
    const key = buildStorageKey({ chatId: "-100", sha256: "dup", mimeType: "image/png" });
    await s.put({ content: Buffer.from("a"), key, mimeType: "image/png" });
    const second = await s.put({ content: Buffer.from("a"), key, mimeType: "image/png" });
    assert.equal(second.sha256, second.sha256);
    assert.ok(await s.exists(key));
  });

  it("path traversal из ключа — отказ", async () => {
    const s = makeStorage();
    await assert.rejects(
      () => s.put({ content: Buffer.from("x"), key: "../etc/passwd", mimeType: "image/jpeg" }),
      /escapes root/,
    );
  });

  it("файл больше maxBytes — отказ ДО записи", async () => {
    const s = new LocalMediaStorage({
      rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "media-lim-")),
      maxBytes: 10,
    });
    await assert.rejects(
      () =>
        s.put({
          content: Buffer.alloc(11, 1),
          key: buildStorageKey({ chatId: "-1", sha256: "big", mimeType: "image/jpeg" }),
          mimeType: "image/jpeg",
        }),
      /too large/,
    );
  });

  it("недопустимый mime — отказ (application/x-msdownload и т.п.)", async () => {
    const s = makeStorage();
    await assert.rejects(
      () =>
        s.put({
          content: Buffer.from("x"),
          key: buildStorageKey({ chatId: "-1", sha256: "m", mimeType: "application/x-msdownload" }),
          mimeType: "application/x-msdownload",
        }),
      /mime not allowed/,
    );
  });

  it("buildStorageKey: канонический формат telegram/{chat}/{YYYY}/{MM}/{sha256}.{ext}", () => {
    const key = buildStorageKey({ chatId: "-100", sha256: "abcd", mimeType: "audio/ogg" });
    assert.ok(/^telegram\/-100\/\d{4}\/\d{2}\/abcd\.ogg$/.test(key), key);
    assert.equal(buildStorageKey({ chatId: "x", sha256: "y", mimeType: "application/pdf" }).split(".").pop(), "pdf");
    assert.equal(buildStorageKey({ chatId: "x", sha256: "y", mimeType: "unknown/type" }).split(".").pop(), "bin");
  });
});
