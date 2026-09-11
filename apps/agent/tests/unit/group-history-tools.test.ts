/**
 * Group history tools — ACL (H1–H3, H6), лимиты (H5), форматтер items и
 * тихий брифинг чека (§4). Репо — реальный SQLite (tmp), ACL — моки.
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
  assertCanReadChat,
  clampInt,
  formatArchiveItem,
  formatExpenseBrief,
  groupHistoryHandler,
  groupRecentHandler,
  type GroupAccessDeps,
  type GroupToolsContext,
} from "../../src/services/documents/groupHistoryTools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo(): DocumentsRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tools-"));
  tmpDirs.push(dir);
  return new DocumentsRepository(path.join(dir, "documents.sqlite"));
}

function archiveRow(
  repo: DocumentsRepository,
  rec: Partial<ChatArchiveRecord> & { id: string; chatId: string },
): ChatArchiveRecord {
  const full: ChatArchiveRecord = {
    kind: "text",
    confidence: 0,
    needsReview: false,
    createdAt: "2026-09-10T10:00:00.000Z",
    ...rec,
  };
  repo.insertArchive(full);
  return full;
}

function deps(overrides: Partial<GroupAccessDeps> = {}): GroupAccessDeps {
  return {
    isConfiguredSync: () => true,
    canManage: async () => false,
    isAllowed: async () => true,
    listConfiguredChatIds: async () => [],
    ...overrides,
  };
}

// ── 1–3: ACL ───────────────────────────────────────────────────────────────

describe("assertCanReadChat (H2/H3)", () => {
  it("not configured → false (H1/H6)", async () => {
    const ok = await assertCanReadChat("42", "-100", deps({ isConfiguredSync: () => false }));
    assert.equal(ok, false);
  });

  it("configured + isAllowed → true", async () => {
    const ok = await assertCanReadChat(
      "42",
      "-100",
      deps({ isAllowed: async (u, c) => u === "42" && c === "-100" }),
    );
    assert.equal(ok, true);
  });

  it("configured + not allowed + not canManage → false", async () => {
    const ok = await assertCanReadChat(
      "42",
      "-100",
      deps({ isAllowed: async () => false, canManage: async () => false }),
    );
    assert.equal(ok, false);
  });

  it("configured + canManage → true даже без isAllowed", async () => {
    const ok = await assertCanReadChat(
      "42",
      "-100",
      deps({ isAllowed: async () => false, canManage: async () => true }),
    );
    assert.equal(ok, true);
  });
});

// ── 4–5: group_history ─────────────────────────────────────────────────────

describe("groupHistoryHandler", () => {
  it("returns mapped items из архива (text + media со storageKey)", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "10", kind: "text", rawText: "привет всем" });
    archiveRow(repo, {
      id: "a2",
      chatId: "-100",
      messageId: "11",
      kind: "photo",
      fileUniqueId: "fu1",
      rawText: "чек: итого 125.00",
      caption: "чек",
      createdAt: "2026-09-10T11:00:00.000Z",
      expenseId: "e1",
    });
    repo.insertMedia({
      chatId: "-100",
      messageId: 11,
      fileUniqueId: "fu1",
      telegramFileId: "tf1",
      storageKey: "media/telegram/-100/2026/09/abc.jpg",
      processingStatus: "processed",
    });

    const out = await groupHistoryHandler(
      { chatId: "-100", limit: 10 },
      { chatId: "-100", userId: "42" },
      repo,
      deps(),
    );
    const parsed = JSON.parse(out) as { chatId: string; count: number; items: Array<Record<string, unknown>> };
    assert.equal(parsed.chatId, "-100");
    assert.equal(parsed.count, 2);
    // Новые первыми.
    const [media, text] = parsed.items;
    assert.equal(text.text, "привет всем");
    assert.equal(text.hasMedia, false);
    assert.equal(media.kind, "photo");
    assert.equal(media.hasMedia, true);
    assert.equal(media.storageKey, "media/telegram/-100/2026/09/abc.jpg");
    assert.equal(media.expenseId, "e1");
    assert.ok(String(media.ocrText).includes("125.00"));
  });

  it("limit clamp: 1000 → 100, 0 → 1; handler не падает на лимитах", async () => {
    assert.equal(clampInt(1000, 1, 100), 100);
    assert.equal(clampInt(999, 1, 100), 100);
    assert.equal(clampInt(0, 1, 100), 1);
    assert.equal(clampInt(-5, 1, 100), 1);
    assert.equal(clampInt(50, 1, 100), 50);

    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "1", rawText: "x" });
    const out = await groupHistoryHandler(
      { chatId: "-100", limit: 9999 },
      { chatId: "-100", userId: "42" },
      repo,
      deps(),
    );
    const parsed = JSON.parse(out) as { count: number };
    assert.equal(parsed.count, 1);
  });

  it("deny для не настроенного чата → «Чат не настроен или нет доступа.»", async () => {
    const repo = makeRepo();
    const out = await groupHistoryHandler(
      { chatId: "-100" },
      { chatId: "-100", userId: "42" },
      repo,
      deps({ isConfiguredSync: () => false }),
    );
    assert.equal(out, ACCESS_DENIED);
  });

  it("kinds + beforeMessageId фильтруют строки", async () => {
    const repo = makeRepo();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "5", kind: "photo", fileUniqueId: "f5" });
    archiveRow(repo, { id: "a2", chatId: "-100", messageId: "9", kind: "text", rawText: "t9" });
    const out = await groupHistoryHandler(
      { chatId: "-100", kinds: ["text"], beforeMessageId: "9" },
      { chatId: "-100", userId: "42" },
      repo,
      deps(),
    );
    const parsed = JSON.parse(out) as { count: number };
    assert.equal(parsed.count, 0, "message 9 не меньше 9 → пусто");
  });
});

// ── 6: group_recent ────────────────────────────────────────────────────────

describe("groupRecentHandler", () => {
  it("без chatId: только доступные чаты (не configured-допуск → нет)", async () => {
    const repo = makeRepo();
    const recent = new Date(Date.now() - 3600_000).toISOString();
    // Активность есть в ОБОИХ чатах; доступ только к -100.
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "1", rawText: "разрешенный", createdAt: recent });
    archiveRow(repo, { id: "a2", chatId: "-200", messageId: "1", rawText: "запрещенный", createdAt: recent });

    const out = await groupRecentHandler(
      { sinceHours: 24 },
      { userId: "42" },
      repo,
      deps({
        listConfiguredChatIds: async () => ["-100", "-200"],
        isAllowed: async (_u, c) => c === "-100",
        canManage: async () => false,
      }),
    );
    const parsed = JSON.parse(out) as { chats: string[]; count: number; items: Array<Record<string, unknown>> };
    assert.deepEqual(parsed.chats, ["-100"]);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.items[0].text, "разрешенный");
  });

  it("canManage видит все configured чаты; sinceHours фильтрует окно", async () => {
    const repo = makeRepo();
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    archiveRow(repo, { id: "a1", chatId: "-100", messageId: "1", rawText: "свежий", createdAt: new Date(Date.now() - 3600_000).toISOString() });
    archiveRow(repo, {
      id: "a2",
      chatId: "-200",
      messageId: "1",
      rawText: "старый",
      createdAt: old,
    });
    const out = await groupRecentHandler(
      { sinceHours: 24, limit: 50 },
      { userId: "42" },
      repo,
      deps({
        listConfiguredChatIds: async () => ["-100", "-200"],
        canManage: async () => true,
      }),
    );
    const parsed = JSON.parse(out) as { count: number; items: Array<Record<string, unknown>> };
    assert.equal(parsed.count, 1, "только события за последние 24ч");
    assert.equal(parsed.items[0].text, "свежий");
  });

  it("явный chatId без доступа → deny", async () => {
    const repo = makeRepo();
    const out = await groupRecentHandler(
      { chatId: "-200" },
      { userId: "42" },
      repo,
      deps({ isAllowed: async () => false }),
    );
    assert.equal(out, ACCESS_DENIED);
  });
});

// ── 7: expense brief ───────────────────────────────────────────────────────

describe("formatExpenseBrief (§4)", () => {
  it("supplier + total, без file_id и техшелухи", () => {
    const text = formatExpenseBrief({
      supplier: "Магнит",
      total: 125,
      currency: "RUB",
      docDate: "2026-09-10",
    });
    assert.equal(text, "Чек: Магнит — 125 RUB, 2026-09-10");
    assert.ok(!text.includes("file_id"));
  });

  it("без supplier → «без названия»", () => {
    assert.equal(formatExpenseBrief({ total: 50 }), "Чек: без названия — 50 RUB, ");
  });
});

// ── H4: formatArchiveItem не отдаёт сырые поля ─────────────────────────────

describe("formatArchiveItem (H4)", () => {
  it("не содержит файловых путей/внутренних id", () => {
    const item = formatArchiveItem({
      id: "internal-id",
      chatId: "-100",
      kind: "document",
      messageId: "7",
      fileId: "AgAC-file",
      fileUniqueId: "fu",
      fileName: "scan.pdf",
      rawText: "очень длинный текст ".repeat(100),
      createdAt: "2026-09-10T10:00:00.000Z",
      confidence: 0.9,
      needsReview: false,
    });
    const json = JSON.stringify(item);
    assert.ok(!json.includes("internal-id"));
    assert.ok(!json.includes("AgAC-file"));
    assert.ok(!json.includes("/home"));
    assert.ok(json.includes("truncated"), "длинный OCR обрезан с флагом");
    assert.equal(String(item.ocrText).length, 500);
  });
});
