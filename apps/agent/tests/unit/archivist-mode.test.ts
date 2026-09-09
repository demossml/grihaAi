import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgMessage, TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { ChatArchiveService } from "../../src/services/documents/chat-archive.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { StubExtractor, type DocumentExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
const tmpFiles: string[] = [];

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop()!, { force: true });
});

function makeRepo(): { repo: DocumentsRepository; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-archive-"));
  tmpDirs.push(dir);
  const repo = new DocumentsRepository(path.join(dir, "documents.sqlite"));
  return { repo, dir };
}

const groupMsg = (extra: Partial<TgMessage> = {}): TgUpdate => ({
  updateId: 1,
  message: {
    from: { id: 42 },
    chat: { id: -100, type: "supergroup" },
    text: "обычное сообщение",
    ...extra,
  },
});

/** Bridge в режиме архивариуса: process=true, suppressReply=!mentioned, archive=true. */
function archivistBridge(sent: string[], archives: Array<{ kind: string; text?: string }>) {
  return new TelegramBridge(
    [42],
    async () => ({ text: "ответ агента" }),
    async (_chatId, text) => {
      sent.push(text);
    },
    {
      prefilter: (input) => ({
        process: true,
        suppressReply: input.botMentioned !== true,
        archive: input.isGroup === true,
      }),
      archiveHandler: async (msg, ctx) => {
        archives.push({ kind: ctx.kind, text: msg.text ?? msg.caption });
        return { stored: true };
      },
    },
  );
}

describe("archivist mode (bridge)", () => {
  it("текст без @mention: архив вызван, агент вызван, ответ подавлен", async () => {
    const sent: string[] = [];
    const archives: Array<{ kind: string; text?: string }> = [];
    let agentCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "ответ агента" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        prefilter: (input) => ({
          process: true,
          suppressReply: input.botMentioned !== true,
          archive: input.isGroup === true,
        }),
        archiveHandler: async (msg, ctx) => {
          archives.push({ kind: ctx.kind, text: msg.text });
          return { stored: true };
        },
      },
    );

    const res = await bridge.handleUpdate(groupMsg());

    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.equal(archives.length, 1, "текст попал в архив");
    assert.equal(archives[0].kind, "text");
    assert.equal(archives[0].text, "обычное сообщение");
    assert.equal(agentCalls, 1, "агент обрабатывает контекст");
    assert.equal(sent.length, 0, "ответа в чат нет");
  });

  it("текст с @mention: архив + обычный ответ", async () => {
    const sent: string[] = [];
    const archives: Array<{ kind: string; text?: string }> = [];
    const bridge = archivistBridge(sent, archives);

    const res = await bridge.handleUpdate(
      groupMsg({ botMentioned: true, text: "@bot посчитай расходы" }),
    );

    assert.equal(res.handled, true);
    assert.equal(archives.length, 1);
    assert.equal(sent.length, 1, "при @mention ответ приходит");
    assert.equal(sent[0], "ответ агента");
  });

  it("фото без @mention: архив kind=photo, ack нет, ответ подавлен", async () => {
    const sent: string[] = [];
    const archives: Array<{ kind: string; text?: string }> = [];
    const bridge = archivistBridge(sent, archives);

    const res = await bridge.handleUpdate(
      groupMsg({
        text: undefined,
        caption: "чек на 100",
        photo: [{ file_id: "p1", file_unique_id: "pu1" }],
      }),
    );

    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.equal(archives.length, 1);
    assert.equal(archives[0].kind, "photo");
    assert.equal(sent.length, 0, "тишина");
  });

  it("документ без @mention: архив kind=document, ответ подавлен", async () => {
    const sent: string[] = [];
    const archives: Array<{ kind: string; text?: string }> = [];
    const bridge = archivistBridge(sent, archives);

    const res = await bridge.handleUpdate(
      groupMsg({
        text: undefined,
        document: { file_id: "d1", file_unique_id: "du1", file_name: "act.pdf", mime_type: "application/pdf" },
      }),
    );

    assert.equal(res.handled, true);
    assert.equal(archives[0].kind, "document");
    assert.equal(sent.length, 0);
  });

  it("обычный prefilter (boolean) работает как раньше", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "ok" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      { prefilter: () => false },
    );
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.reason, "blocked-by-rules");
    assert.equal(sent.length, 0);
  });
});

describe("ChatArchiveService", () => {
  it("archiveText: сохраняет, дедуп по chat_id + message_id", async () => {
    const { repo } = makeRepo();
    const service = new ChatArchiveService(repo, new StubExtractor());
    const first = await service.archiveText({
      chatId: -100,
      threadId: "15",
      messageId: 77,
      fromUserId: 42,
      text: "текст в тему",
    });
    const dup = await service.archiveText({
      chatId: -100,
      messageId: 77,
      fromUserId: 42,
      text: "дубль",
    });
    assert.ok(first);
    assert.equal(first.kind, "text");
    assert.equal(first.threadId, "15");
    assert.equal(first.fromUserId, "42");
    assert.equal(first.rawText, "текст в тему");
    assert.equal(dup!.id, first.id, "дедуп вернул существующую запись");
    assert.equal(repo.countArchive("-100"), 1);
    assert.equal(repo.countArchive("-200"), 0);
  });

  it("archiveMedia photo: скачивает → extract → запись; дедуп по file_unique_id", async () => {
    const { repo } = makeRepo();
    const service = new ChatArchiveService(repo, new StubExtractor());
    const file = path.join(os.tmpdir(), `archive-photo-${Date.now()}.jpg`);
    tmpFiles.push(file);
    fs.writeFileSync(file, "jpeg");

    const msg = {
      chat: { id: -100, type: "supergroup" },
      from: { id: 42 },
      messageId: 5,
      caption: "фото документа",
      photo: [{ file_id: "p1", file_unique_id: "pu1" }],
    };
    const rec = await service.archiveMedia(msg, { download: async () => file });
    assert.ok(rec);
    assert.equal(rec!.kind, "photo");
    assert.equal(rec!.rawText, "фото документа");
    assert.equal(rec!.needsReview, true, "stub честно требует проверку");

    const dup = await service.archiveMedia(msg, { download: async () => file });
    assert.equal(dup!.id, rec!.id, "медиа-дедуп по file_unique_id");
    assert.equal(repo.countArchive("-100"), 1);
  });

  it("archiveMedia чек: kind=expense + дубль в expense_documents (одно скачивание)", async () => {
    const { repo } = makeRepo();
    const checkExtractor: DocumentExtractor = {
      async extract() {
        return {
          kind: "receipt",
          docDate: "2026-09-01",
          supplier: "Ромашка",
          total: 15400,
          currency: "RUB",
          rawText: "Ромашка 15400 RUB",
          items: [{ name: "позиция", sum: 15400 }],
          confidence: 0.6,
          needsReview: true,
        };
      },
    };
    const service = new ChatArchiveService(repo, checkExtractor);
    const file = path.join(os.tmpdir(), `archive-check-${Date.now()}.jpg`);
    tmpFiles.push(file);
    fs.writeFileSync(file, "jpeg");

    let downloads = 0;
    const rec = await service.archiveMedia(
      {
        chat: { id: -100, type: "supergroup" },
        from: { id: 42 },
        messageId: 9,
        caption: "Ромашка 15400 RUB",
        photo: [{ file_id: "p2", file_unique_id: "pu2" }],
      },
      {
        download: async () => {
          downloads++;
          return file;
        },
      },
    );
    assert.ok(rec);
    assert.equal(rec!.kind, "expense", "распознанный чек → expense");
    assert.equal(downloads, 1);
    assert.equal(repo.countArchive("-100"), 1);
    const expense = await repo.findByFileUniqueId("-100", "pu2");
    assert.ok(expense, "чек дополнительно в expense_documents");
  });

  it("неподдерживаемый документ всё равно архивируется (kind=document, needsReview)", async () => {
    const { repo } = makeRepo();
    const service = new ChatArchiveService(repo, new StubExtractor());
    const file = path.join(os.tmpdir(), `archive-zip-${Date.now()}.zip`);
    tmpFiles.push(file);
    fs.writeFileSync(file, "zip-bytes");

    const rec = await service.archiveMedia(
      {
        chat: { id: -100, type: "supergroup" },
        from: { id: 42 },
        messageId: 11,
        document: { file_id: "d2", file_unique_id: "du2", file_name: "a.zip", mime_type: "application/zip" },
      },
      { download: async () => file },
    );
    assert.ok(rec, "архивируем всё, не только чеки");
    assert.equal(rec!.kind, "document");
    assert.equal(rec!.fileName, "a.zip");
  });
});
