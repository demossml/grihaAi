/**
 * ListenerMediaPipeline — единый production-конвейер медиа (PROMPT 04/05):
 *
 *   resolve file → persistent storage → metadata → content extraction
 *     (photo→OCR, document→OCR, voice→STT) → archive → structured ingest
 *
 * Одно скачивание на файл. Файл ОСТАЁТСЯ в постоянном хранилище
 * (MediaStorage), в /tmp — только рабочая копия для extractor'а.
 * Повторная доставка: file_unique_id → reuse сохранённого файла (без повторного
 * скачивания), бизнес-записи не дублируются.
 *
 * Не зависит от вызова LLM (L2): вызывается из processMedia (index.ts) и из
 * media-retry worker'а (L6 — ретрай выполняет ПОЛНЫЙ pipeline, не только archive).
 */
import { createHash, randomUUID } from "node:crypto";
import { todayYmd } from "./extractors/parsers.js";
import { normalizeThreadId } from "../../../.pi/extensions/telegram-bot/threads.js";
import type { DocumentExtractor } from "./extractors/types.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseDocument } from "./types.js";
import type { ChatArchiveRecord } from "./chat-archive.js";
import type { MediaRetryJob } from "./media-retry.js";
import { assessTranscriptConfidence } from "../../utils/telegram/voice-intake.js";
import { buildStorageKey, type MediaStorage } from "./media-storage.js";
import { ocrSizeAndHintGate } from "./ocr-limiter.js";
import type {
  ClassifyExpenseInput,
  ClassifyExpenseResult,
} from "./classify-expense.js";

export type MediaKind =
  | "photo"
  | "document"
  | "voice"
  | "video"
  | "video_note"
  | "audio";

export interface ListenerMediaInput {
  chatId: string;
  threadId?: string;
  messageId?: string;
  fromUserId?: string;
  caption?: string;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  /** G10: правка исходного медиа (edited_message) — ревизия архива. */
  isEdited?: boolean;
  photo?: Array<{ file_id: string; file_unique_id?: string }>;
  document?: {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
  };
  voice?: { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string };
  video?: { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string };
  video_note?: { file_id: string; file_unique_id?: string; duration?: number };
  audio?: { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string; file_name?: string };
}

export interface VoiceResult {
  transcript: string;
  confidence?: number;
  needsReview: boolean;
}

export interface ListenerMediaResult {
  archived: boolean;
  ingestedExpense: boolean;
  expenseId?: string;
  confidence: number;
  needsReview: boolean;
  rawText?: string;
  caption?: string;
  error?: string;
}

export interface ListenerMediaOptions {
  /** Писать сырой архив (default true). */
  archive?: boolean;
  /** Писать expense_documents при распознанных полях (default true). */
  ocrIngest?: boolean;
  /** G3: пропустить извлечение (rate limit/gates) — только storage + archive. */
  skipExtraction?: boolean;
  /** G3: гейты размера/подсказок (проверяются после download). */
  ocrMinBytes?: number;
  ocrMaxBytes?: number;
  skipOcrIfNoHint?: boolean;
}

export interface ListenerMediaProcessFn {
  process(
    input: ListenerMediaInput,
    opts?: ListenerMediaOptions,
  ): Promise<ListenerMediaResult>;
}

/** STT-зависимость: filePath → транскрипт (структурно совместима с @griha/stt). */
export type SttFn = (filePath: string) => Promise<{ ok: boolean; text: string; error?: string }>;

export interface ListenerMediaDeps {
  /** Постоянное хранилище файлов (PROMPT 05). Без него — только /tmp (тесты). */
  storage?: MediaStorage;
  /** STT для voice (PROMPT 04). Без него voice → needsReview без текста. */
  stt?: SttFn;
  /** Фабрика рабочего temp-файла (тесты). */
  makeTemp?: () => Promise<string>;
  /**
   * §4 тихий брифинг по чеку (owner DM): вызывается только при успешном
   * structured ingest и наличии суммы. Сбой уведомления НЕ ломает конвейер.
   */
  notifyExpenseBrief?: (info: ExpenseBriefInfo) => Promise<void>;
  /**
   * F2/F3: классификация после OCR (свободная категория + позиции).
   * Сбой классификации не блокирует ingest — category=null.
   */
  classifyExpense?: (input: ClassifyExpenseInput) => Promise<ClassifyExpenseResult>;
}

/** Данные брифинга: без file_id/путей — только бизнес-поля. */
export interface ExpenseBriefInfo {
  chatId: string;
  threadId?: string;
  supplier?: string;
  total: number;
  currency?: string;
  docDate?: string;
}

/** Файл: фото — самый большой размер (последний), документ/voice — любой. */
function resolveFile(input: ListenerMediaInput): {
  kind: MediaKind;
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
} | null {
  if (input.photo && input.photo.length > 0) {
    const last = input.photo[input.photo.length - 1];
    if (!last.file_id) return null;
    return {
      kind: "photo",
      fileId: last.file_id,
      fileUniqueId: last.file_unique_id ?? last.file_id,
      fileName: undefined,
      mimeType: "image/jpeg",
    };
  }
  if (input.document?.file_id) {
    return {
      kind: "document",
      fileId: input.document.file_id,
      fileUniqueId: input.document.file_unique_id ?? input.document.file_id,
      fileName: input.document.file_name,
      mimeType: input.document.mime_type,
    };
  }
  if (input.voice?.file_id) {
    return {
      kind: "voice",
      fileId: input.voice.file_id,
      fileUniqueId: input.voice.file_unique_id ?? input.voice.file_id,
      mimeType: input.voice.mime_type ?? "audio/ogg",
      duration: input.voice.duration,
    };
  }
  if (input.video?.file_id) {
    return {
      kind: "video",
      fileId: input.video.file_id,
      fileUniqueId: input.video.file_unique_id ?? input.video.file_id,
      mimeType: input.video.mime_type ?? "video/mp4",
      duration: input.video.duration,
    };
  }
  if (input.video_note?.file_id) {
    return {
      kind: "video_note",
      fileId: input.video_note.file_id,
      fileUniqueId: input.video_note.file_unique_id ?? input.video_note.file_id,
      mimeType: "video/mp4",
      duration: input.video_note.duration,
    };
  }
  if (input.audio?.file_id) {
    return {
      kind: "audio",
      fileId: input.audio.file_id,
      fileUniqueId: input.audio.file_unique_id ?? input.audio.file_id,
      mimeType: input.audio.mime_type ?? "audio/mpeg",
      duration: input.audio.duration,
    };
  }
  return null;
}

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export class ListenerMediaPipeline implements ListenerMediaProcessFn {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly extractor: DocumentExtractor,
    private readonly download: (fileId: string) => Promise<string>,
    private readonly deps: ListenerMediaDeps = {},
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
    const storage = this.deps.storage;
    const fs = await import("node:fs/promises");

    let tempPath: string | null = null;
    let storedId: number | null = null;

    try {
      // ── 1-2) persistent storage + metadata (PROMPT 05) ─────────────────────
      const existing = this.repo.findMediaByFileUniqueId(input.chatId, file.fileUniqueId);
      if (existing && storage && (await storage.exists(existing.storageKey))) {
        // Повторная доставка: физический файл сохранён — reuse, не скачиваем.
        const buf = await storage.get(existing.storageKey);
        tempPath = await this.writeTemp(buf, fs);
        storedId = existing.id;
      } else {
        tempPath = await this.download(file.fileId);
        const buf = await fs.readFile(tempPath);
        if (storage) {
          const sha256 = sha256Of(buf);
          const key = buildStorageKey({
            chatId: input.chatId,
            sha256,
            mimeType: file.mimeType,
          });
          await storage.put({
            content: buf,
            key,
            mimeType: file.mimeType,
            originalName: file.fileName,
          });
          const rec = this.repo.insertMedia({
            chatId: input.chatId,
            messageId: input.messageId !== undefined ? Number(input.messageId) : 0,
            threadId: normalizeThreadId(input.threadId),
            fileUniqueId: file.fileUniqueId,
            telegramFileId: file.fileId,
            storageKey: key,
            mimeType: file.mimeType,
            fileName: file.fileName,
            sizeBytes: buf.length,
            sha256,
            caption: input.caption,
            processingStatus: "stored",
          });
          storedId = rec.id;
        }
      }
      if (storedId !== null) this.repo.updateMediaStatus(storedId, "processing");

      // ── 3) extraction: photo/document → OCR; voice/audio/video_note → STT;
      //        video → без извлечения (честный needsReview, G5); G3 gates ─────
      const audioLike = file.kind === "voice" || file.kind === "audio" || file.kind === "video_note";
      let extracted: Awaited<ReturnType<DocumentExtractor["extract"]>> | null = null;
      let voice: VoiceResult | null = null;
      let skipExtraction = opts.skipExtraction === true;
      if (!skipExtraction && !audioLike && file.kind !== "video") {
        // G3: размер/подсказка — только для OCR-видов (photo/document).
        try {
          const stat = await fs.stat(tempPath);
          const gate = ocrSizeAndHintGate({
            sizeBytes: stat.size,
            caption: input.caption,
            policy: {
              minFileSizeBytes: opts.ocrMinBytes,
              maxFileSizeBytes: opts.ocrMaxBytes,
              skipIfNoDocumentHint: opts.skipOcrIfNoHint,
            },
          });
          if (!gate.ok) skipExtraction = true;
        } catch {
          /* stat упал — продолжаем с извлечением */
        }
      }
      if (skipExtraction) {
        // G3: rate limit/gates — файл сохранён, извлечение не выполняем.
      } else if (audioLike) {
        voice = await this.transcribe(tempPath);
      } else if (file.kind === "video") {
        // Покадровый OCR видео — future work; сохраняем и честно помечаем.
      } else {
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
      }

      const isExpense =
        extracted?.kind === "receipt" ||
        extracted?.kind === "invoice" ||
        extracted?.kind === "waybill";
      // Полезные поля — не только kind receipt/invoice: unknown+сумма тоже в expenses.
      const hasUseful =
        extracted != null &&
        (extracted.total != null ||
          Boolean(extracted.supplier) ||
          Boolean(extracted.rawText && extracted.rawText.length > 20));

      const now = new Date().toISOString();
      let expenseId: string | undefined;
      let ingestedExpense = false;

      // ── F2/F3: классификация (свободная категория/позиции) — после OCR, до БД.
      let classification: ClassifyExpenseResult | undefined;
      if (extracted?.rawText && this.deps.classifyExpense) {
        try {
          classification = await this.deps.classifyExpense({
            chatId: input.chatId,
            rawText: extracted.rawText,
            supplier: extracted.supplier,
            total: extracted.total,
            memoryHints: [], // заполняет вызывающий (documents/index.ts)
          });
        } catch (err: unknown) {
          console.error(
            "[listener-media] classify failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      // ── 5) structured ingest (только photo/document; voice/audio/video — никогда не expense) ──
      if ((file.kind === "photo" || file.kind === "document") && ocrIngest && hasUseful && extracted) {
        if (!(await this.repo.findByFileUniqueId(input.chatId, file.fileUniqueId))) {
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
            category: classification?.category ?? null,
            tags: classification?.tags,
            lineItems: classification?.lineItems ?? null,
            createdAt: now,
            updatedAt: now,
          };
          const inserted = await this.repo.insert(doc);
          expenseId = inserted.id;
          ingestedExpense = true;
          // §4: тихий брифинг — только по факту инжеста И суммы (не needsReview-only).
          if (extracted.total != null && this.deps.notifyExpenseBrief) {
            try {
              await this.deps.notifyExpenseBrief({
                chatId: input.chatId,
                threadId: normalizeThreadId(input.threadId),
                supplier: extracted.supplier,
                total: extracted.total,
                currency: extracted.currency ?? "RUB",
                docDate: extracted.docDate,
              });
            } catch (err: unknown) {
              console.error(
                "[listener-media] expense brief notify failed:",
                err instanceof Error ? err.message : err,
              );
            }
          }
        } else {
          expenseId = (await this.repo.findByFileUniqueId(input.chatId, file.fileUniqueId))?.id;
        }
      }

      // ── 4) сырой архив (raw_text и caption отдельно, PROMPT 04) ────────────
      let archived = false;
      if (archiveEnabled) {
        const existingArchive = this.repo.findArchiveByFileUniqueId(
          input.chatId,
          file.fileUniqueId,
        );
        if (existingArchive) {
          // G10: правка медиа — обновляем raw/caption и ревизию, не дублируем.
          if (input.isEdited) {
            this.repo.updateArchiveMediaRevision(input.chatId, file.fileUniqueId, {
              rawText: existingArchive.rawText,
              caption: input.caption,
            });
          }
          archived = true; // уже был
        } else {
          const archiveKind: ChatArchiveRecord["kind"] =
            audioLike || file.kind === "video"
              ? file.kind
              : isExpense
                ? "expense"
                : file.kind;
          const rawText = audioLike ? voice?.transcript || undefined : extracted?.rawText;
          this.repo.insertArchive({
            id: randomUUID(),
            chatId: input.chatId,
            threadId: normalizeThreadId(input.threadId),
            messageId: input.messageId,
            fromUserId: input.fromUserId,
            kind: archiveKind,
            docDate: extracted?.docDate ?? todayYmd(),
            supplier: isExpense ? extracted?.supplier : undefined,
            total: isExpense ? extracted?.total : undefined,
            currency: isExpense ? extracted?.currency ?? "RUB" : undefined,
            rawText,
            caption: input.caption || undefined,
            fileId: file.fileId,
            fileUniqueId: file.fileUniqueId,
            fileName: file.fileName,
            mimeType: file.mimeType,
            itemsJson: extracted?.items?.length ? JSON.stringify(extracted.items) : undefined,
            confidence: audioLike ? voice?.confidence ?? 0 : extracted?.confidence ?? 0,
            needsReview: audioLike ? voice?.needsReview ?? true : extracted?.needsReview ?? true,
            createdAt: now,
            ocrStatus: rawText ? "done" : "failed",
            expenseId,
          });
          archived = true;
        }
      }

      if (storedId !== null && !skipExtraction) {
        const hasContent =
          audioLike
            ? Boolean(voice?.transcript)
            : file.kind === "video"
              ? true // файл сохранён; извлечения по дизайну нет (G5)
              : extracted != null &&
                (Boolean(extracted.rawText) ||
                  extracted.total != null ||
                  Boolean(extracted.supplier));
        this.repo.updateMediaStatus(
          storedId,
          hasContent ? "processed" : "failed",
          hasContent ? undefined : "extraction returned no content",
        );
      }

      return {
        archived,
        ingestedExpense,
        expenseId,
        confidence: audioLike ? voice?.confidence ?? 0 : extracted?.confidence ?? 0,
        needsReview: audioLike ? voice?.needsReview ?? true : extracted?.needsReview ?? true,
        rawText: audioLike ? voice?.transcript || undefined : extracted?.rawText,
        caption: input.caption,
      };
    } catch (err: unknown) {
      if (storedId !== null) {
        // Файл сохранён; сбой обработки не удаляет единственную копию (PROMPT 04).
        this.repo.updateMediaStatus(
          storedId,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      }
      throw err;
    } finally {
      if (tempPath) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private async transcribe(filePath: string): Promise<VoiceResult> {
    if (!this.deps.stt) {
      return { transcript: "", confidence: 0, needsReview: true };
    }    try {
      const result = await this.deps.stt(filePath);
      const assessment = assessTranscriptConfidence(result);
      return {
        transcript: result.ok ? result.text.trim() : "",
        confidence: assessment.confidence,
        needsReview: !result.ok || assessment.uncertain || result.text.trim().length === 0,
      };
    } catch (err: unknown) {
      console.error(
        "[listener-media] STT failed:",
        err instanceof Error ? err.message : err,
      );
      return { transcript: "", confidence: 0, needsReview: true };
    }
  }

  private async writeTemp(buf: Buffer, fs: typeof import("node:fs/promises")): Promise<string> {
    if (this.deps.makeTemp) {
      const dest = await this.deps.makeTemp();
      await fs.writeFile(dest, buf);
      return dest;
    }
    const os = await import("node:os");
    const path = await import("node:path");
    const dest = path.join(
      os.tmpdir(),
      `griha-media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.writeFile(dest, buf);
    return dest;
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
      : job.kind === "voice"
        ? { voice: { file_id: job.fileId, file_unique_id: job.fileUniqueId } }
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
