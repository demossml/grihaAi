/**
 * ChatArchiveService — архив всех входящих сообщений/медиа группы (режим
 * «Слушатель-архивариус», listen_only). Таблица `chat_archive` в том же
 * `documents.sqlite`, что и `expense_documents`.
 *
 * - Текст: дедуп по (chat_id, message_id).
 * - Медиа (фото/документы): скачать → extract (OCR/парсинг) → дедуп по
 *   (chat_id, file_unique_id); распознанные чеки/накладные дополнительно
 *   пишутся в expense_documents (одно скачивание, расходы продолжают работать).
 * - Сырой OCR-текст сохраняется как есть + флаги (needs_review/confidence).
 */
import { randomUUID } from "node:crypto";
import { todayYmd } from "./extractors/parsers.js";
import { normalizeThreadId } from "../../../.pi/extensions/telegram-bot/threads.js";
import type { DocumentExtractor } from "./extractors/types.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseDocument } from "./types.js";
import type { TelegramFileMessage } from "./DocumentIngestService.js";

export type ArchiveKind =
  | "text"
  | "photo"
  | "document"
  | "voice"
  | "video"
  | "video_note"
  | "audio"
  | "expense";

export interface ChatArchiveRecord {
  id: string;
  chatId: string;
  threadId?: string;
  messageId?: string;
  fromUserId?: string;
  kind: ArchiveKind;
  /** YYYY-MM-DD */
  docDate?: string;
  supplier?: string;
  total?: number;
  currency?: string;
  /** Текст сообщения или OCR-текст медиа (сырой, как есть). */
  rawText?: string;
  /** Подпись (caption) отдельно от OCR/STT-текста (PROMPT 04). */
  caption?: string;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  itemsJson?: string;
  /** 0..1 */
  confidence: number;
  needsReview: boolean;
  createdAt: string;
  /** Статус распознавания (L-OCR): pending|done|failed. */
  ocrStatus?: "pending" | "done" | "failed";
  /** Ссылка на expense_documents после structured ingest (опционально). */
  expenseId?: string;
  /** Правка (edited_message/edited_channel_post): версия записи. */
  isEdited?: boolean;
  revision?: number;
}

export interface ArchiveTextInput {
  chatId: string | number;
  threadId?: string | number;
  messageId?: string | number;
  fromUserId?: string | number;
  text: string;
  /** Правка исходного сообщения (edited_message/edited_channel_post). */
  isEdited?: boolean;
}

/** Файл для архива: фото — самый большой размер (последний), документ — любой. */
function resolveAnyFile(message: TelegramFileMessage): {
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
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    };
  }
  return null;
}

export interface ArchiveDeps {
  download: (fileId: string) => Promise<string>;
}

export class ChatArchiveService {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly extractor: DocumentExtractor,
  ) {}

  /** Архив текстового сообщения (дедуп по chat_id + message_id; правки — ревизии). */
  async archiveText(input: ArchiveTextInput): Promise<ChatArchiveRecord | null> {
    const chatId = String(input.chatId);
    const messageId = input.messageId !== undefined ? String(input.messageId) : undefined;
    if (messageId !== undefined) {
      const existing = this.repo.findArchiveByMessageId(chatId, messageId);
      if (existing) {
        // Правка: обновляем текст и ревизию, дубликат не создаём (PROMPT 02).
        if (input.isEdited || input.text !== existing.rawText) {
          return this.repo.updateArchiveRevision(chatId, messageId, input.text);
        }
        return existing;
      }
    }
    return this.repo.insertArchive({
      id: randomUUID(),
      chatId,
      threadId: normalizeThreadId(input.threadId),
      messageId,
      fromUserId: input.fromUserId !== undefined ? String(input.fromUserId) : undefined,
      kind: "text",
      docDate: todayYmd(),
      rawText: input.text,
      confidence: 0,
      needsReview: false,
      createdAt: new Date().toISOString(),
      isEdited: input.isEdited === true,
      revision: 1,
    });
  }

  /**
   * Архив медиа (фото/документ): скачать → extract → запись.
   * Дедуп по (chat_id, file_unique_id). Распознанный чек/накладная
   * дополнительно попадает в expense_documents (одно скачивание).
   */
  async archiveMedia(
    message: TelegramFileMessage,
    deps: ArchiveDeps,
  ): Promise<ChatArchiveRecord | null> {
    const file = resolveAnyFile(message);
    if (!file) return null;

    const chatId = String(message.chat.id);
    if (file.fileUniqueId) {
      const existing = this.repo.findArchiveByFileUniqueId(chatId, file.fileUniqueId);
      if (existing) return existing;
    }

    let tempPath: string | null = null;
    try {
      tempPath = await deps.download(file.fileId);

      let extracted: Awaited<ReturnType<DocumentExtractor["extract"]>> | null = null;
      try {
        extracted = await this.extractor.extract({
          filePath: tempPath,
          mimeType: file.mimeType,
          fileName: file.fileName,
          caption: message.caption,
        });
      } catch (err: unknown) {
        console.error(
          "[chat-archive] extraction failed:",
          err instanceof Error ? err.message : err,
        );
      }

      const isExpense =
        extracted?.kind === "receipt" || extracted?.kind === "invoice" || extracted?.kind === "waybill";
      const kind: ArchiveKind = isExpense
        ? "expense"
        : message.photo?.length
          ? "photo"
          : "document";

      const now = new Date().toISOString();
      const record: ChatArchiveRecord = {
        id: randomUUID(),
        chatId,
        threadId: normalizeThreadId(message.threadId),
        messageId: message.messageId !== undefined ? String(message.messageId) : undefined,
        fromUserId: message.from?.id !== undefined ? String(message.from.id) : undefined,
        kind,
        docDate: extracted?.docDate ?? todayYmd(),
        supplier: isExpense ? extracted?.supplier : undefined,
        total: isExpense ? extracted?.total : undefined,
        currency: isExpense ? extracted?.currency ?? "RUB" : undefined,
        rawText: extracted?.rawText,
        fileId: file.fileId,
        fileUniqueId: file.fileUniqueId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        itemsJson: extracted?.items?.length ? JSON.stringify(extracted.items) : undefined,
        confidence: extracted?.confidence ?? 0,
        needsReview: extracted?.needsReview ?? true,
        createdAt: now,
      };
      this.repo.insertArchive(record);

      // Чек/накладная: расходы группы должны продолжать работать (expenses_sum и т.п.).
      if (isExpense && extracted) {
        const doc: ExpenseDocument = {
          id: randomUUID(),
          chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          fromUserId: record.fromUserId,
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
          itemsJson: record.itemsJson,
          confidence: extracted.confidence,
          needsReview: extracted.needsReview,
          source: "telegram",
          createdAt: now,
          updatedAt: now,
        };
        await this.repo.insert(doc);
      }

      return record;
    } finally {
      if (tempPath) {
        const fs = await import("node:fs/promises");
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

/**
 * Точка входа из TelegramBridge: развести text/photo/document по сервису.
 * Возвращает stored + флаги качества распознавания (R-GR-8).
 */
export async function archiveFromTelegram(
  message: TelegramFileMessage & { text?: string },
  opts: { kind: "text" | "photo" | "document" | "voice" },
  service: ChatArchiveService,
  deps: ArchiveDeps,
): Promise<{ stored: boolean; needsReview?: boolean; confidence?: number }> {
  if (opts.kind === "text") {
    const text = message.text?.trim();
    if (!text) return { stored: false };
    const record = await service.archiveText({
      chatId: message.chat.id,
      threadId: message.threadId,
      messageId: message.messageId,
      fromUserId: message.from?.id,
      text,
      isEdited: (message as { isEdited?: boolean }).isEdited === true,
    });
    return { stored: record !== null, needsReview: false, confidence: 1 };
  }
  const record = await service.archiveMedia(message, deps);
  return {
    stored: record !== null,
    needsReview: record?.needsReview,
    confidence: record?.confidence,
  };
}
