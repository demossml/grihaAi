/**
 * S11 — group_report: сводка по чату (сообщения/файлы + сумма расходов),
 * scope-фильтры, пустая структура, ACL deny.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ChatArchiveRecord } from "../../src/services/documents/chat-archive.js";
import type { ExpenseDocument } from "../../src/services/documents/types.js";
import {
  ACCESS_DENIED,
  groupReportHandler,
  type GroupAccessDeps,
} from "../../src/services/documents/groupHistoryTools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-report-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function archiveRow(
  repo: DocumentsRepository,
  rec: Partial<ChatArchiveRecord> & { id: string; chatId: string },
): void {
  const full: ChatArchiveRecord = {
    kind: "text",
    confidence: 0,
    needsReview: false,
    createdAt: "2026-09-10T10:00:00.000Z",
    ...rec,
  };
  repo.insertArchive(full);
}

function expenseRow(
  repo: DocumentsRepository,
  rec: { id: string; chatId: string; total: number; docDate: string },
): void {
  const doc: ExpenseDocument = {
    id: rec.id,
    chatId: rec.chatId,
    kind: "receipt",
    docDate: rec.docDate,
    supplier: "X",
    total: rec.total,
    currency: "RUB",
    confidence: 0.7,
    needsReview: false,
    source: "telegram",
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
  };
  repo.insert(doc);
}

function deps(allowed: boolean): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => allowed,
    listConfiguredChatIds: async () => ["-100"],
  };
}

describe("groupReportHandler (S11)", () => {
  it("считает сообщения/файлы + сумму расходов", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "1", chatId: "-100", messageId: "1", kind: "text", rawText: "привет" });
    archiveRow(repo, { id: "2", chatId: "-100", messageId: "2", kind: "photo", rawText: "чек", fileUniqueId: "fu1" });
    expenseRow(repo, { id: "e1", chatId: "-100", total: 100, docDate: "2026-09-10" });

    const out = await groupReportHandler(
      { sourceChatId: "-100" },
      { userId: "42" },
      repo,
      deps(true),
    );
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.equal(r.messageCount, 1);
    assert.equal(r.fileCount, 1);
    assert.equal(r.expenseCount, 1);
    assert.equal(r.expenseTotal, 100);
    assert.equal(r.currency, "RUB");
  });

  it("scope-фильтры dateFrom/dateTo", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "1", chatId: "-100", messageId: "1", kind: "text", rawText: "вчера", createdAt: "2026-09-01T10:00:00.000Z" });
    archiveRow(repo, { id: "2", chatId: "-100", messageId: "2", kind: "text", rawText: "сегодня", createdAt: "2026-09-15T10:00:00.000Z" });

    const out = await groupReportHandler(
      { sourceChatId: "-100", dateFrom: "2026-09-10", dateTo: "2026-09-20" },
      { userId: "42" },
      repo,
      deps(true),
    );
    const r = JSON.parse(out) as { messageCount: number };
    assert.equal(r.messageCount, 1, "только сообщение в окне дат");
  });

  it("пусто → структура со счётчиками 0 (не выдуманный текст)", async () => {
    const repo = makeRepo();
    const out = await groupReportHandler(
      { sourceChatId: "-100" },
      { userId: "42" },
      repo,
      deps(true),
    );
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.equal(r.messageCount, 0);
    assert.equal(r.fileCount, 0);
    assert.equal(r.expenseCount, 0);
    assert.equal(r.expenseTotal, 0);
  });

  it("deny → ACCESS_DENIED", async () => {
    const repo = makeRepo();
    const out = await groupReportHandler(
      { sourceChatId: "-100" },
      { userId: "42" },
      repo,
      deps(false),
    );
    assert.equal(out, ACCESS_DENIED);
  });

  it("title пробрасывается из getChatTitle (chat-A → «Ремонт»)", async () => {
    const repo = makeRepo();
    const out = await groupReportHandler(
      { sourceChatId: "chat-A" },
      { userId: "42" },
      repo,
      {
        ...deps(true),
        getChatTitle: (id) => (id === "chat-A" ? "Ремонт" : undefined),
      },
    );
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.equal(r.title, "Ремонт");
    assert.equal(r.chatId, "chat-A");
  });

  it("title null если getChatTitle вернул undefined", async () => {
    const repo = makeRepo();
    const out = await groupReportHandler(
      { sourceChatId: "-100" },
      { userId: "42" },
      repo,
      { ...deps(true), getChatTitle: () => undefined },
    );
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.equal(r.title, null);
  });
});
