/**
 * S10 — groups_compare: cross-group сравнение, provenance (sourceChatId/
 * sourceMessageId), ACL fail-closed.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import type { ChatArchiveRecord } from "../../src/services/documents/chat-archive.js";
import {
  ACCESS_DENIED,
  groupCompareHandler,
  type GroupAccessDeps,
} from "../../src/services/documents/groupHistoryTools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-compare-"));
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
    createdAt: new Date().toISOString(),
    ...rec,
  };
  repo.insertArchive(full);
}

function deps(allowed: (chatId: string) => boolean): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async (_u, c) => allowed(c),
    listConfiguredChatIds: async () => ["-100", "-200"],
  };
}

describe("groupCompareHandler (S10)", () => {
  it("allow A+B → items с sourceChatId/sourceMessageId", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "1", rawText: "из A" });
    archiveRow(repo, { id: "a2", chatId: "-200", messageId: "2", rawText: "из B" });

    const out = await groupCompareHandler(
      { chatIds: ["-100", "-200"] },
      { userId: "42" },
      repo,
      deps(() => true),
    );
    const parsed = JSON.parse(out) as { count: number; items: Array<Record<string, unknown>> };
    assert.equal(parsed.count, 2);
    assert.equal(parsed.items[0].sourceChatId, "-200");
    assert.equal(parsed.items[0].sourceMessageId, "2");
    assert.ok(parsed.items.some((i) => i.sourceChatId === "-100"));
  });

  it("deny если B forbidden → ACCESS_DENIED (fail closed)", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "1", rawText: "из A" });
    archiveRow(repo, { id: "a2", chatId: "-200", messageId: "2", rawText: "из B" });

    const out = await groupCompareHandler(
      { chatIds: ["-100", "-200"] },
      { userId: "42" },
      repo,
      deps((c) => c === "-100"),
    );
    assert.equal(out, ACCESS_DENIED);
  });

  it("пустой chatIds → подсказка", async () => {
    const repo = makeRepo();
    const out = await groupCompareHandler(
      { chatIds: [] },
      { userId: "42" },
      repo,
      deps(() => true),
    );
    assert.ok(out.includes("Укажите chatIds"));
  });

  it("groups заголовок с title для A и B (разные названия)", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "chat-A", messageId: "1", rawText: "из A" });
    archiveRow(repo, { id: "a2", chatId: "chat-B", messageId: "2", rawText: "из B" });

    const out = await groupCompareHandler(
      { chatIds: ["chat-A", "chat-B"] },
      { userId: "42" },
      repo,
      {
        ...deps(() => true),
        getChatTitle: (id) => (id === "chat-A" ? "Ремонт" : id === "chat-B" ? "Офис" : undefined),
      },
    );
    const parsed = JSON.parse(out) as { groups: Array<{ chatId: string; title: string | null }> };
    const byId = new Map(parsed.groups.map((g) => [g.chatId, g.title]));
    assert.equal(byId.get("chat-A"), "Ремонт");
    assert.equal(byId.get("chat-B"), "Офис");
  });

  it("title null для чата без getChatTitle результата", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "chat-A", messageId: "1", rawText: "из A" });

    const out = await groupCompareHandler(
      { chatIds: ["chat-A"] },
      { userId: "42" },
      repo,
      { ...deps(() => true), getChatTitle: () => undefined },
    );
    const parsed = JSON.parse(out) as { groups: Array<{ chatId: string; title: string | null }> };
    assert.equal(parsed.groups[0].title, null);
  });
});
