/**
 * S9 — Reconnect acceptance (§ reconnect), без живого Telegram.
 * Реальные ChatSetupService + DocumentsRepository + ChatArchiveService (SQLite tmp).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { ChatArchiveService } from "../../src/services/documents/chat-archive.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reconnect-"));
  tmpDirs.push(dir);
  const rules = { replaceChatManagedRules() {}, getHardRules: () => [], getSoftRules: () => [] };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup, dir };
}

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reconnect-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

const dummyExtractor: DocumentExtractor = {
  async extract() {
    return { kind: "unknown", confidence: 0, needsReview: true };
  },
};

describe("Reconnect acceptance (S9)", () => {
  it("archived → reactivate: данные живы, один record, история N+1, дедуп message_id", async () => {
    const { setup } = makeSetup();
    const repo = makeRepo();
    const archive = new ChatArchiveService(repo, dummyExtractor);
    const chatId = "-100";

    // 1) setup active secretary chatId=X.
    await setup.markPending({ chatId, chatType: "group", addedByUserId: "1" });
    await setup.applyScenario(chatId, "secretary", { actorId: "1" });
    assert.equal((await setup.get(chatId))?.scenario, "secretary");

    // 2) N archive rows + media meta for X.
    const N = 3;
    for (let i = 1; i <= N; i++) {
      await archive.archiveText({ chatId, threadId: "15", messageId: String(i), fromUserId: "42", text: `msg ${i}` });
    }
    repo.insertMedia({
      chatId,
      messageId: 1,
      threadId: "15",
      fileUniqueId: "fu1",
      telegramFileId: "tf1",
      storageKey: "media/telegram/-100/fu1.ogg",
      mimeType: "audio/ogg",
      processingStatus: "processed",
    });

    // 3) markArchived(X).
    await setup.markArchived(chatId);

    // 4) archive rows still N.
    assert.equal(repo.countArchive(chatId), N, "архив не удалён");

    // 5) reactivate X.
    await setup.reactivateFromArchived(chatId);

    // 6) один record, scenario secretary, active.
    const all = (await setup.list()).filter((c) => c.chatId === chatId);
    assert.equal(all.length, 1, "одна запись на чат");
    assert.equal(all[0].scenario, "secretary");
    assert.equal(all[0].status, "active");

    // threadId continuity: записи сохранили тему.
    const first = repo.findArchiveByMessageId(chatId, "1");
    assert.equal(first?.threadId, "15", "threadId сохранён");

    // 7) новая строка → история N+1.
    await archive.archiveText({ chatId, threadId: "15", messageId: String(N + 1), fromUserId: "42", text: "новое" });
    assert.equal(repo.countArchive(chatId), N + 1, "история N+1");

    // 8) дубликат message_id → по-прежнему одна логическая запись (дедуп).
    await archive.archiveText({ chatId, threadId: "15", messageId: String(N + 1), fromUserId: "42", text: "новое" });
    assert.equal(repo.countArchive(chatId), N + 1, "дедуп по message_id");
  });
});
