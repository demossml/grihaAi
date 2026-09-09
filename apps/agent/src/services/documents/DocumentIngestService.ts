/**
 * DocumentIngestService — ingest файла из Telegram: dedup → download → extract →
 * insert → cleanup temp.
 */
import { randomUUID } from "node:crypto";
import { todayYmd } from "./extractors/parsers.js";
import { normalizeThreadId } from "../../../.pi/extensions/telegram-bot/threads.js";
import type { DocumentExtractor } from "./extractors/types.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseDocument } from "./types.js";

/** Минимальная поверхность Telegram-сообщения с файлом. */
export interface TelegramFileMessage {
  chat: { id: number; type?: string };
  from?: { id?: number };
  messageId?: number;
  /** Тема форума (message_thread_id). */
  threadId?: string | number;
  caption?: string;
  photo?: Array<{ file_id?: string; file_unique_id?: string }>;
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
  };
}

export interface IngestDeps {
  download: (fileId: string) => Promise<string>;
}

/** Какой файл инжестим: фото — самый большой размер (последний). */
function resolveFile(message: TelegramFileMessage): {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
} | null {
  if (message.photo && message.photo.length > 0) {
    const last = message.photo[message.photo.length - 1];
    if (!last.file_id) return null;
    return {
      fileId: last.file_id,
      fileUniqueId: last.file_unique_id,
      fileName: undefined,
      mimeType: "image/jpeg",
    };
  }
  if (message.document?.file_id) {
    const mime = message.document.mime_type ?? "";
    const isSupported = /pdf|image\/jpeg|image\/png|image\/webp|jpg|png|webp/i.test(mime);
    if (mime && !isSupported) return null; // не чек/накладная
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    };
  }
  return null;
}

/** Короткий ack без спама (§8). */
export function documentAck(doc: ExpenseDocument): string {
  if (doc.total !== undefined) {
    return `Сохранил: ${doc.supplier ?? "?"} — ${doc.total} ${doc.currency} (${doc.docDate})`;
  }
  return "Документ сохранён, нужна проверка суммы/поставщика.";
}

export class DocumentIngestService {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly extractor: DocumentExtractor,
  ) {}

  async ingestFromTelegram(
    message: TelegramFileMessage,
    deps: IngestDeps,
  ): Promise<ExpenseDocument> {
    const file = resolveFile(message);
    if (!file) throw new Error("no supported file in message");

    const chatId = String(message.chat.id);
    // Дедуп: тот же file_unique_id в том же чате → существующая запись.
    if (file.fileUniqueId) {
      const existing = await this.repo.findByFileUniqueId(chatId, file.fileUniqueId);
      if (existing) return existing;
    }

    let tempPath: string | null = null;
    try {
      tempPath = await deps.download(file.fileId);
      const extracted = await this.extractor.extract({
        filePath: tempPath,
        mimeType: file.mimeType,
        fileName: file.fileName,
        caption: message.caption,
      });

      const now = new Date().toISOString();
      const doc: ExpenseDocument = {
        id: randomUUID(),
        chatId,
        threadId: normalizeThreadId(message.threadId),
        messageId: message.messageId !== undefined ? String(message.messageId) : undefined,
        fromUserId: message.from?.id !== undefined ? String(message.from.id) : undefined,
        fileId: file.fileId,
        fileUniqueId: file.fileUniqueId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        kind: extracted.kind,
        docDate: extracted.docDate ?? todayYmd(),
        supplier: extracted.supplier,
        total: extracted.total,
        currency: extracted.currency ?? "RUB",
        rawText: extracted.rawText,
        itemsJson: extracted.items?.length ? JSON.stringify(extracted.items) : undefined,
        confidence: extracted.confidence,
        needsReview: extracted.needsReview,
        source: "telegram",
        createdAt: now,
        updatedAt: now,
      };
      return this.repo.insert(doc);
    } finally {
      if (tempPath) {
        const fs = await import("node:fs/promises");
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }
}
