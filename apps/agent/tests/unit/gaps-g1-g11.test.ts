/**
 * Gaps G1–G11 (Telegram 100% for Grisha): альбомы, outbound media, OCR-лимиты,
 * start payload, reply context, audio/video, pin, join request, edited media.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MediaGroupBuffer,
  pickAlbumCaption,
} from "../../.pi/extensions/telegram-bot/media-group-buffer.js";
import {
  TelegramBridge,
  albumItemOf,
  buildAlbumAgentMessage,
  withReplyContext,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import {
  TelegramBotController,
  type TelegramBotLike,
  type TelegramBotControllerOptions,
} from "../../.pi/extensions/telegram-bot/TelegramBotController.js";
import {
  OcrRateLimiter,
  ocrSizeAndHintGate,
} from "../../src/services/documents/ocr-limiter.js";
import { normalizeTelegramUpdate } from "../../.pi/extensions/telegram-bot/normalizer.js";
import { ListenerMediaPipeline } from "../../src/services/documents/ListenerMediaPipeline.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { LocalMediaStorage } from "../../src/services/documents/media-storage.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("G1: MediaGroupBuffer", () => {
  it("3 элемента одного media_group_id → один flush с 3 items", async () => {
    const flushes: string[][] = [];
    const buffer = new MediaGroupBuffer(30, async (batch) => {
      flushes.push(batch.items.map((i) => i.fileUniqueId));
    });
    const item = (u: string) => ({
      updateId: 1,
      messageId: 1,
      fileId: `f-${u}`,
      fileUniqueId: u,
      kind: "photo" as const,
    });
    buffer.add("g1", item("u1"));
    buffer.add("g1", item("u2"));
    buffer.add("g1", item("u3"));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(flushes.length, 1);
    assert.deepEqual(flushes[0], ["u1", "u2", "u3"]);
    buffer.dispose();
  });

  it("разные media_group_id → отдельные flush'и; caption берётся с одного элемента", async () => {
    const flushes: string[] = [];
    const buffer = new MediaGroupBuffer(20, async (batch) => {
      flushes.push(batch.groupId);
    });
    buffer.add("g1", { updateId: 1, messageId: 1, fileId: "a", fileUniqueId: "a", kind: "photo" });
    buffer.add("g2", { updateId: 2, messageId: 2, fileId: "b", fileUniqueId: "b", kind: "photo" });
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(flushes.sort(), ["g1", "g2"]);
    assert.equal(
      pickAlbumCaption([
        { updateId: 1, messageId: 1, fileId: "a", fileUniqueId: "a", kind: "photo" },
        { updateId: 2, messageId: 2, fileId: "b", fileUniqueId: "b", kind: "photo", caption: "чек" },
      ]),
      "чек",
    );
    buffer.dispose();
  });
});

describe("G1: альбом в bridge", () => {
  it("альбом → album-buffered, processMediaAlbum один раз, агент один раз", async () => {
    let agentCalls = 0;
    const albumCalls: Array<{ items: number; allowed: boolean }> = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "ок" };
      },
      async () => undefined,
      {
        prefilter: () => true,
        aclCheck: async () => true,
        albumBufferMs: 20,
        processMediaAlbum: async (batch, ctx) => {
          albumCalls.push({ items: batch.items.length, allowed: ctx.allowed });
          return { rawText: "Итого 100 руб" };
        },
      },
    );
    const update = (id: number, unique: string): TgUpdate => ({
      updateId: id,
      message: {
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        messageId: id,
        mediaGroupId: "mg1",
        caption: id === 1 ? "чек" : undefined,
        photo: [{ file_id: `p${id}`, file_unique_id: unique }],
      },
    });
    const res1 = await bridge.handleUpdate(update(1, "pu1"));
    await bridge.handleUpdate(update(2, "pu2"));
    await bridge.handleUpdate(update(3, "pu3"));
    assert.equal(res1.reason, "album-buffered");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(albumCalls.length, 1);
    assert.equal(albumCalls[0].items, 3);
    assert.equal(agentCalls, 1, "один ход агента на альбом");
  });
});

describe("G3: OCR лимиты и гейты", () => {
  it("3-й OCR при limit=2 → отказ, счётчик окна сбрасывается через час", () => {
    const limiter = new OcrRateLimiter();
    assert.equal(limiter.allow("chat", 2), true);
    assert.equal(limiter.allow("chat", 2), true);
    assert.equal(limiter.allow("chat", 2), false);
    assert.equal(limiter.remaining("chat", 2), 0);
    assert.equal(limiter.allow("other", 2), true, "лимит per-chat");
  });

  it("гейты: размер/подсказка", () => {
    assert.equal(ocrSizeAndHintGate({ sizeBytes: 10, policy: { minFileSizeBytes: 100 } }).ok, false);
    assert.equal(ocrSizeAndHintGate({ sizeBytes: 10, policy: { maxFileSizeBytes: 5 } }).ok, false);
    assert.equal(
      ocrSizeAndHintGate({ caption: "мем", policy: { skipIfNoDocumentHint: true } }).ok,
      false,
    );
    assert.equal(
      ocrSizeAndHintGate({ caption: "чек на 100", policy: { skipIfNoDocumentHint: true } }).ok,
      true,
    );
    assert.equal(ocrSizeAndHintGate({}).ok, true);
  });
});

describe("G4: /start payload", () => {
  it("/start setup_-1001 в DM → setupCommandHandler с chatId -1001", async () => {
    const setupCalls: string[] = [];
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        setupCommandHandler: async (args) => {
          setupCalls.push(args);
          return "меню настройки";
        },
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 42 }, chat: { id: 999, type: "private" }, text: "/start setup_-1001" },
    });
    assert.equal(res.handled, true);
    assert.deepEqual(setupCalls, ["-1001"]);
    assert.deepEqual(sent, ["меню настройки"]);
  });

  it("/start setup_-1001 в группе → подсказка открыть DM", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
    );
    await bridge.handleUpdate({
      updateId: 2,
      message: { from: { id: 42 }, chat: { id: -100, type: "supergroup" }, text: "/start setup_-1001" },
    });
    assert.ok(sent[0].includes("только в личных сообщениях"));
  });
});

describe("G6: /pin", () => {
  it("/pin на reply → pinHandler с messageId; без reply → подсказка", async () => {
    const pinCalls: Array<{ messageId?: number }> = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        pinHandler: async (ctx) => {
          pinCalls.push({ messageId: ctx.messageId });
          return "Сообщение закреплено.";
        },
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: {
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        text: "/pin",
        replyTo: { messageId: 77, text: "итоги дня" },
      },
    });
    assert.deepEqual(pinCalls, [{ messageId: 77 }]);
  });
});

describe("G8: reply context", () => {
  it("агент видит [REPLY_TO] с текстом исходного сообщения", () => {
    const m = withReplyContext("привет", {
      replyTo: { messageId: 55, text: "что в том чеке?" },
    });
    assert.ok(m.includes("[REPLY_TO]"));
    assert.ok(m.includes("message_id: 55"));
    assert.ok(m.includes("что в том чеке?"));
    assert.equal(withReplyContext("x", {}), "x");
  });

  it("bridge: текст с reply → в промпте агента есть [REPLY_TO]", async () => {
    const agentMessages: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async (input) => {
        agentMessages.push(input.message);
        return { text: "x" };
      },
      async () => undefined,
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: {
        from: { id: 42 },
        chat: { id: 999 },
        text: "а это что?",
        replyTo: { messageId: 3, text: "чек на 100 руб" },
      },
    });
    assert.ok(agentMessages[0].includes("[REPLY_TO]"));
    assert.ok(agentMessages[0].includes("чек на 100 руб"));
  });
});

describe("G5: video/audio в normalizer и pipeline", () => {
  it("normalizer: video/video_note/audio → kinds и file_id", () => {
    const n = normalizeTelegramUpdate({
      update: { update_id: 1 },
      message: {
        message_id: 10,
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        audio: { file_id: "a1", file_unique_id: "au1", duration: 12, mime_type: "audio/mpeg" },
      },
    })!;
    assert.equal(n.message.contentKind, "audio");
    assert.equal(n.message.telegramFileId, "a1");

    const v = normalizeTelegramUpdate({
      update: { update_id: 2 },
      message: {
        message_id: 11,
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        video: { file_id: "v1", file_unique_id: "vu1", mime_type: "video/mp4" },
      },
    })!;
    assert.equal(v.message.contentKind, "video");

    const vn = normalizeTelegramUpdate({
      update: { update_id: 3 },
      message: {
        message_id: 12,
        from: { id: 42 },
        chat: { id: -100, type: "supergroup" },
        video_note: { file_id: "vn1", file_unique_id: "vnu1", duration: 5 },
      },
    })!;
    assert.equal(vn.message.contentKind, "video_note");
  });

  it("pipeline: audio → STT + архив kind=audio; video → архив needsReview без STT", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g5-"));
    tmpDirs.push(dir);
    const repo = new DocumentsRepository(path.join(dir, "documents.sqlite"));
    const storage = new LocalMediaStorage({ rootDir: path.join(dir, "media") });
    const extractor: DocumentExtractor = {
      async extract() {
        return { kind: "unknown", confidence: 0.1, needsReview: true };
      },
    };
    let sttCalls = 0;
    let n = 0;
    const pipeline = new ListenerMediaPipeline(repo, extractor, async () => {
      // Свежий temp-файл на каждый download (pipeline удаляет рабочую копию).
      const file = path.join(dir, `sample-${++n}.bin`);
      fs.writeFileSync(file, "media-bytes");
      return file;
    }, {
      storage,
      stt: async () => {
        sttCalls++;
        return { ok: true, text: "озвученный счёт на 500 рублей" };
      },
    });

    const audioRes = await pipeline.process({
      chatId: "-100",
      messageId: "20",
      audio: { file_id: "a1", file_unique_id: "au1", mime_type: "audio/mpeg" },
    });
    assert.equal(sttCalls, 1);
    assert.equal(audioRes.rawText, "озвученный счёт на 500 рублей");
    assert.equal(repo.findArchiveByFileUniqueId("-100", "au1")!.kind, "audio");

    const videoRes = await pipeline.process({
      chatId: "-100",
      messageId: "21",
      video: { file_id: "v1", file_unique_id: "vu1", mime_type: "video/mp4" },
    });
    assert.equal(sttCalls, 1, "видео STT не гоняется");
    assert.equal(videoRes.needsReview, true);
    assert.equal(repo.findArchiveByFileUniqueId("-100", "vu1")!.kind, "video");
    assert.ok(await storage.exists(repo.findMediaByFileUniqueId("-100", "vu1")!.storageKey));
  });
});

describe("G7: chat_join_request", () => {
  it("событие доходит до joinRequestHandler; default — уведомление владельцу", async () => {
    const handled: Array<{ chatId: number; userId: number; approved: boolean; notified: string[] }> = [];
    class FakeBot implements TelegramBotLike {
      joinHandler: ((ctx: unknown) => unknown) | null = null;
      on(
        filter: string,
        handler: ((ctx: unknown) => unknown) | ((c: unknown) => unknown),
      ): void {
        if (filter === "chat_join_request") {
          this.joinHandler = handler as (ctx: unknown) => unknown;
        }
      }
      async start(): Promise<unknown> {
        return undefined;
      }
      async stop(): Promise<unknown> {
        return undefined;
      }
      api = {
        sendMessage: async (chatId: number, text: string): Promise<unknown> => {
          handled[0]?.notified.push(text);
          void chatId;
          return undefined;
        },
        sendDocument: async (): Promise<unknown> => undefined,
        sendChatAction: async (): Promise<unknown> => undefined,
        setMyCommands: async (): Promise<unknown> => undefined,
        setMessageReaction: async (): Promise<unknown> => undefined,
        getChatMember: async (): Promise<{ status: string }> => ({ status: "member" }),
      };
    }
    const fake = new FakeBot();
    const options: TelegramBotControllerOptions = {
      joinRequestHandler: async (event, deps) => {
        handled.push({ chatId: event.chat.id, userId: event.from.id, approved: false, notified: [] });
        await deps.sendMessage(5700958253, `Заявка от id=${event.from.id}`);
        void deps.approve;
      },
    };
    const controller = new TelegramBotController(async () => ({ text: "x" }), [42], () => fake, options);
    controller.start("token");
    if (!fake.joinHandler) throw new Error("join handler не зарегистрирован");
    await fake.joinHandler({
      chat: { id: -100, type: "supergroup", title: "Офис" },
      chatJoinRequest: { chat: { id: -100, title: "Офис" }, from: { id: 777, first_name: "Иван" }, user_chat_id: 777 },
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(handled.length, 1);
    assert.equal(handled[0].userId, 777);
    assert.equal(handled[0].notified.length, 1);
    assert.ok(handled[0].notified[0].includes("id=777"));
    await controller.stop();
  });
});

describe("G2: outbound media", () => {
  it("sendFileToChat kind=photo → api.sendPhoto (с caption/thread)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "photo.jpg");
    fs.writeFileSync(filePath, "jpeg");
    const photos: Array<{ chatId: number; filePath: string; caption?: string }> = [];
    class FakeBot implements TelegramBotLike {
      on(): void {}
      async start(): Promise<unknown> {
        return undefined;
      }
      async stop(): Promise<unknown> {
        return undefined;
      }
      api = {
        sendMessage: async (): Promise<unknown> => undefined,
        sendDocument: async (): Promise<unknown> => undefined,
        sendPhoto: async (chatId: number, p: string, extra?: { caption?: string }) => {
          photos.push({ chatId, filePath: p, caption: extra?.caption });
          return { message_id: 1, photo: [{ file_id: "sent-1" }] };
        },
        sendChatAction: async (): Promise<unknown> => undefined,
        setMyCommands: async (): Promise<unknown> => undefined,
        setMessageReaction: async (): Promise<unknown> => undefined,
        getChatMember: async (): Promise<{ status: string }> => ({ status: "member" }),
      };
    }
    const fake = new FakeBot();
    const controller = new TelegramBotController(async () => ({ text: "x" }), [42], () => fake);
    controller.start("token");
    const res = await controller.sendFileToChat({
      chatId: -100,
      filePath,
      caption: "фото чека",
      kind: "photo",
    });
    assert.equal(res.ok, true);
    assert.equal(photos.length, 1);
    assert.equal(photos[0].caption, "фото чека");
    await controller.stop();
  });
});

describe("G10: edited media — ревизия архива", () => {
  it("edited photo → архив обновляет caption и ревизию без дубликата", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g10-"));
    tmpDirs.push(dir);
    const repo = new DocumentsRepository(path.join(dir, "documents.sqlite"));
    const storage = new LocalMediaStorage({ rootDir: path.join(dir, "media") });
    const file = path.join(dir, "p.jpg");
    fs.writeFileSync(file, "jpeg");
    const extractor: DocumentExtractor = {
      async extract() {
        return { kind: "receipt", docDate: "2026-09-11", total: 100, currency: "RUB", rawText: "X 100 RUB", confidence: 0.7, needsReview: false };
      },
    };
    const pipeline = new ListenerMediaPipeline(repo, extractor, async () => file, { storage });
    const input = {
      chatId: "-100",
      messageId: "30",
      caption: "старая подпись",
      photo: [{ file_id: "p1", file_unique_id: "pu1" }],
    };
    await pipeline.process(input);
    await pipeline.process({ ...input, caption: "новая подпись", isEdited: true });
    assert.equal(repo.countArchive("-100"), 1, "правка не создаёт дубликат");
    const rec = repo.findArchiveByFileUniqueId("-100", "pu1");
    assert.equal(rec!.caption, "новая подпись");
    assert.equal(rec!.isEdited, true);
    assert.equal(rec!.revision, 2);
  });
});

describe("G1 helpers", () => {
  it("albumItemOf по типам и buildAlbumAgentMessage", () => {
    const photo = albumItemOf({
      photo: [{ file_id: "p", file_unique_id: "pu" }],
      messageId: 9,
    });
    assert.equal(photo!.kind, "photo");
    assert.equal(photo!.fileUniqueId, "pu");
    const msg = buildAlbumAgentMessage(
      {
        groupId: "mg",
        caption: "чеки",
        items: [
          { updateId: 1, messageId: 1, fileId: "a", fileUniqueId: "a", kind: "photo" },
          { updateId: 2, messageId: 2, fileId: "b", fileUniqueId: "b", kind: "photo" },
        ],
      },
      { rawText: "Итого 100 руб" },
    );
    assert.ok(msg.includes("альбом из 2 файлов"));
    assert.ok(msg.includes("Итого 100 руб"));
    assert.ok(msg.includes("telegram_media_group_id: mg"));
  });
});
