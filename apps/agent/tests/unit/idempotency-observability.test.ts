/**
 * S13 — Idempotency / observability hardening (tests; код менять только если
 * тест докажет баг).
 *
 * - duplicate update_id → уже покрыто telegram-update-dedup.test.ts;
 * - file_unique_id дедуп → listener-media-pipeline.test.ts;
 * - здесь: sanitization diag (без секретов/стека), never-throws, и
 *   «archive after retry» (processMediaRetryJob дважды → без дублей).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  logTelegramError,
  formatTelegramError,
} from "../../.pi/extensions/telegram-bot/telegram-diagnostics.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import {
  ListenerMediaPipeline,
  processMediaRetryJob,
} from "../../src/services/documents/ListenerMediaPipeline.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";
import type { MediaRetryJob } from "../../src/services/documents/media-retry.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const emptyExtractor: DocumentExtractor = {
  async extract() {
    return { kind: "unknown", confidence: 0.1, needsReview: true };
  },
};

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s13-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function makeFile(name: string): string {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, "bytes");
  return file;
}

describe("diag sanitization (S13)", () => {
  it("formatTelegramError: Error → 'Name: message' без стека", () => {
    const err = new Error("boom");
    assert.ok(err.stack && err.stack.includes("idempotency-observability"), "у err реальный стек");
    const out = formatTelegramError(err);
    assert.equal(out, "Error: boom", "только Name: message");
    assert.ok(!out.includes("idempotency-observability"), "стек не попадает в diag");
  });

  it("logTelegramError: в выводе chatId/operation, НЕ бросает, без сырого текста", () => {
    let captured = "";
    const orig = console.error;
    console.error = (msg: unknown) => {
      captured += String(msg);
    };
    try {
      logTelegramError({
        operation: "voice_transcribe",
        chatId: "-100",
        userId: "42",
        error: new Error("stt down"),
        detail: "kind=forbidden",
      });
    } finally {
      console.error = orig;
    }
    assert.ok(captured.includes("voice_transcribe"), "operation в логе");
    assert.ok(captured.includes("-100"), "chatId в логе");
    assert.ok(!captured.includes("someStackLine"), "нет постороннего текста");
  });

  it("logTelegramError не бросает на несериализуемом error", () => {
    const orig = console.error;
    console.error = () => undefined;
    try {
      // circular → JSON.stringify упал бы, но guard внутри должен спасти.
      const circ: Record<string, unknown> = {};
      circ.self = circ;
      logTelegramError({ operation: "x", error: circ });
    } finally {
      console.error = orig;
    }
    // дошло сюда — значит не бросило.
    assert.ok(true);
  });
});

describe("archive after retry idempotent (S13)", () => {
  it("processMediaRetryJob дважды на том же file_unique_id → 1 строка архива", async () => {
    const repo = makeRepo();
    const pipeline = new ListenerMediaPipeline(repo, emptyExtractor, async () => makeFile("retry"), {
      stt: async () => ({ ok: true, text: "раз" }),
    });
    const job: MediaRetryJob = {
      id: "j1",
      chatId: "-100",
      threadId: "15",
      messageId: "8",
      fileId: "v1",
      fileUniqueId: "vu1",
      kind: "voice",
      attempts: 1,
      maxAttempts: 10,
      nextAttemptAt: new Date().toISOString(),
      status: "processing",
      createdAt: "t",
      updatedAt: "t",
    };
    await processMediaRetryJob(job, pipeline);
    await processMediaRetryJob(job, pipeline);
    assert.equal(repo.countArchive("-100"), 1, "ретрай не дублирует архив");
  });
});
