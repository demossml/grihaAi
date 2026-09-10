/**
 * ListenerMediaPipeline — полный фоновый конвейер медиа в режиме listen_only:
 * download → extract (OCR/парсинг) → chat_archive (сырой) → при распознанных
 * полях и policy archive_ocr_ingest → expense_documents. Одно скачивание на файл.
 *
 * Не зависит от вызова LLM (L2): вызывается из archiveHandler (index.ts) и из
 * media-retry worker'а (L6 — ретрай выполняет ПОЛНЫЙ pipeline, не только archive).
 */
import { randomUUID } from "node:crypto";
import { todayYmd } from "./extractors/parsers.js";
import { normalizeThreadId } from "../../../.pi/extensions/telegram-bot/threads.js";
import type { DocumentExtractor } from "./extractors/types.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseDocument } from "./types.js";
import type { ChatArchiveRecord } from "./chat-archive.js";
import type { MediaRetryJob } from "./media-retry.js";

export interface ListenerMediaInput {
  chatId: string;
  threadId?: string;
  messageId?: string;
  fromUserId?: string;
  caption?: string;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  photo?: Array<{ file_id: string; file_unique_id?: string }>;
  document?: {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
  };
}

export interface ListenerMediaResult {
  archived: boolean;
  ingestedExpense: boolean;
  expenseId?: string;
  confidence: number;
  needsReview: boolean;
  rawText?: string;
  error?: string;
}

export interface ListenerMediaOptions {
  /** Писать сырой архив (default true). */
  archive?: boolean;
  /** Писать expense_documents при распознанных полях (default true). */
  ocrIngest?: boolean;
}

export interface ListenerMediaProcessFn {
  process(
    input: ListenerMediaInput,
    opts?: ListenerMediaOptions,
  ): Promise<ListenerMediaResult>;
}

/** Файл: фото — самый большой размер (последний), документ — любой. */
function resolveFile(input: ListenerMediaInput): {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
} | null {
  if (input.photo && input.photo.length > 0) {
    const last = input.photo[input.photo.length - 1];
    if (!last.file_id) return null;
    return {
      fileId: last.file_id,
      fileUniqueId: last.file_unique_id,
      fileName: undefined,
      mimeType: "image/jpeg",
    };
  }
  if (input.document?.file_id) {
    return {
      fileId: input.document.file_id,
      fileUniqueId: input.document.file_unique_id,
      fileName: input.document.file_name,
      mimeType: input.document.mime_type,
    };
  }
  return null;
}

export class ListenerMediaPipeline implements ListenerMediaProcessFn {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly extractor: DocumentExtractor,
    private readonly download: (fileId: string) => Promise<string>,
  ) {}

  /**
   * Полный конвейер. Идемпотентен: повторный вызов с тем же file_unique_id
   * не дублирует строки (L7: expense-дедуп, archive-дедуп — в репо).
   */
  async process(
    input: ListenerMediaInput,
    opts: ListenerMediaOptions = {},
  ): Promise<ListenerMediaResult> {
    const file = resolveFile(input);
    if (!file) {
      return { archived: false, ingestedExpense: false, confidence: 0, needsReview: true };
    }
    const archiveEnabled = opts.archive ?? true;
    const ocrIngest = opts.ocrIngest ?? true;

    let tempPath: string | null = null;
    try {
      tempPath = await this.download(file.fileId);

      let extracted: Awaited<ReturnType<DocumentExtractor["extract"]>> | null = null;
      try {
        extracted = await this.extractor.extract({
          filePath: tempPath,
          mimeType: file.mimeType,
          fileName: file.fileName,
          caption: input.caption,
        });
      } catch (err: unknown) {
        console.error(
          "[listener-media] extraction failed:",
          err instanceof Error ? err.message : err,
        );
      }

      const isExpense =
        extracted?.kind === "receipt" ||
        extracted?.kind === "invoice" ||
        extracted?.kind === "waybill";
      const hasUseful =
        extracted != null &&
        (extracted.total !== undefined || Boolean(extracted.supplier) || Boolean(extracted.rawText));

      const now = new Date().toISOString();
      let expenseId: string | undefined;
      let ingestedExpense = false;

      // 5) structured ingest: только то, что вернул extractor (L8), только при policy.
      if (ocrIngest && isExpense && hasUseful && extracted) {
        if (!file.fileUniqueId || !(await this.repo.findByFileUniqueId(input.chatId, file.fileUniqueId))) {
          const doc: ExpenseDocument = {
            id: randomUUID(),
            chatId: input.chatId,
            threadId: normalizeThreadId(input.threadId),
            messageId: input.messageId,
            fromUserId: input.fromUserId,
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
          const inserted = await this.repo.insert(doc);
          expenseId = inserted.id;
          ingestedExpense = true;
        } else {
          expenseId = (
            await this.repo.findByFileUniqueId(input.chatId, file.fileUniqueId)
          )?.id;
        }
      }

      // 4) сырой архив (если archive_media) — после OCR, один раз.
      let archived = false;
      if (archiveEnabled) {
        if (
          file.fileUniqueId &&
          this.repo.findArchiveByFileUniqueId(input.chatId, file.fileUniqueId)
        ) {
          archived = true; // уже был
        } else {
          const kind: ChatArchiveRecord["kind"] = isExpense
            ? "expense"
            : input.photo?.length
              ? "photo"
              : "document";
          this.repo.insertArchive({
            id: randomUUID(),
            chatId: input.chatId,
            threadId: normalizeThreadId(input.threadId),
            messageId: input.messageId,
            fromUserId: input.fromUserId,
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
            ocrStatus: extracted ? "done" : "failed",
            expenseId,
          });
          archived = true;
        }
      }

      return {
        archived,
        ingestedExpense,
        expenseId,
        confidence: extracted?.confidence ?? 0,
        needsReview: extracted?.needsReview ?? true,
        rawText: extracted?.rawText,
      };
    } finally {
      if (tempPath) {
        const fs = await import("node:fs/promises");
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

/** MediaRetryJob → ListenerMediaInput (полный pipeline на ретрае, L6). */
export function jobToListenerInput(job: MediaRetryJob): ListenerMediaInput {
  return {
    chatId: job.chatId,
    threadId: job.threadId,
    messageId: job.messageId,
    ...(job.kind === "photo"
      ? { photo: [{ file_id: job.fileId, file_unique_id: job.fileUniqueId }] }
      : { document: { file_id: job.fileId, file_unique_id: job.fileUniqueId } }),
  };
}

/** Обработка retry-жоба полным pipeline (не только сырым архивом). */
export async function processMediaRetryJob(
  job: MediaRetryJob,
  pipeline: ListenerMediaProcessFn,
): Promise<ListenerMediaResult> {
  return pipeline.process(jobToListenerInput(job));
}
