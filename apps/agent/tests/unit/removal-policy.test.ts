/**
 * S8 — Removal policy end-to-end: markArchived НЕ удаляет данные,
 * archived останавливает слушание; reactivate возвращает слушание.
 * Реальные ChatSetupService + DocumentsRepository (SQLite tmp).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ChatArchiveRecord } from "../../src/services/documents/chat-archive.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "removal-"));
  tmpDirs.push(dir);
  const rules = { replaceChatManagedRules() {}, getHardRules: () => [], getSoftRules: () => [] };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup, dir };
}

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "removal-repo-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function archiveRow(repo: DocumentsRepository, id: string, chatId: string): void {
  const rec: ChatArchiveRecord = {
    id,
    chatId,
    messageId: id,
    kind: "text",
    rawText: `msg ${id}`,
    confidence: 0,
    needsReview: false,
    createdAt: "2026-09-10T10:00:00.000Z",
  };
  repo.insertArchive(rec);
}

function expenseRow(repo: DocumentsRepository, id: string, chatId: string): void {
  const doc: ExpenseDocument = {
    id,
    chatId,
    kind: "receipt",
    docDate: "2026-09-10",
    supplier: "X",
    total: 100,
    currency: "RUB",
    confidence: 0.7,
    needsReview: false,
    source: "telegram",
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
  };
  repo.insert(doc);
}

describe("Removal policy end-to-end (S8)", () => {
  it("markArchived останавливает слушание (isConfiguredSync=false), reactivate возвращает", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.applyScenario("-100", "secretary", { actorId: "1" });
    assert.equal(setup.isConfiguredSync("-100"), true, "active слушает");

    await setup.markArchived("-100");
    assert.equal(setup.isConfiguredSync("-100"), false, "archived НЕ слушает");

    await setup.reactivateFromArchived("-100");
    assert.equal(setup.isConfiguredSync("-100"), true, "reactivate возвращает слушание");
  });

  it("markArchived НЕ удаляет chat_archive/expense (данные живы)", async () => {
    const { setup } = makeSetup();
    const repo = makeRepo();
    const chatId = "-100";
    archiveRow(repo, "a1", chatId);
    archiveRow(repo, "a2", chatId);
    expenseRow(repo, "e1", chatId);

    await setup.markPending({ chatId, chatType: "group", addedByUserId: "1" });
    await setup.markCompleted(chatId, "listener");
    await setup.markArchived(chatId);

    assert.equal(repo.countArchive(chatId), 2, "архив не тронут");
    const expenses = await repo.query({ chatId });
    assert.equal(expenses.count, 1, "расход не тронут");
    assert.equal((await setup.get(chatId))?.status, "archived");
  });

  it("полный цикл archived→active сохраняет scenario и данные", async () => {
    const { setup } = makeSetup();
    const repo = makeRepo();
    const chatId = "-100";
    archiveRow(repo, "a1", chatId);

    await setup.markPending({ chatId, chatType: "group", addedByUserId: "1" });
    await setup.applyScenario(chatId, "secretary", { actorId: "1" });
    await setup.markArchived(chatId);
    await setup.reactivateFromArchived(chatId);

    const rec = await setup.get(chatId);
    assert.equal(rec?.status, "active");
    assert.equal(rec?.scenario, "secretary", "сценарий сохранён");
    assert.equal(repo.countArchive(chatId), 1, "данные сохранены");
  });
});
