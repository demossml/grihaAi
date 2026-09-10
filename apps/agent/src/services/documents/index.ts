/**
 * documents/index — синглтоны + точка входа сервиса документов/расходов.
 */
import path from "node:path";
import { getConfigDir, loadConfig } from "@griha/config";
import { createHttpVisionCaller } from "../../utils/vision/http-vision.js";
import { DocumentsRepository } from "./DocumentsRepository.js";
import { DocumentIngestService } from "./DocumentIngestService.js";
import { ChatArchiveService } from "./chat-archive.js";
import { ListenerMediaPipeline } from "./ListenerMediaPipeline.js";
import {
  createExtractor,
  type VisionOcrFn,
} from "./extractors/types.js";

let repository: DocumentsRepository | null = null;
let ingestService: DocumentIngestService | null = null;
let archiveService: ChatArchiveService | null = null;
let listenerPipeline: ListenerMediaPipeline | null = null;

/**
 * Тот же vision-backend, что и analyze_image в личном чате: читает файл в
 * base64 → createHttpVisionCaller → распознанный текст. Без vision.apiKey —
 * undefined (честный stub).
 */
function buildVisionOcr(): VisionOcrFn | undefined {
  const cfg = loadConfig();
  const vision = cfg?.models?.vision;
  if (!vision?.apiKey) return undefined;
  const caller = createHttpVisionCaller();
  return async (filePath: string, mimeType?: string) => {
    const fs = await import("node:fs/promises");
    const b64 = (await fs.readFile(filePath)).toString("base64");
    const mime = mimeType && mimeType.trim() !== "" ? mimeType : "image/jpeg";
    return caller(vision, { source: "base64", value: `data:${mime};base64,${b64}` }, "ocr");
  };
}

export function getDocumentsRepository(): DocumentsRepository {
  if (!repository) {
    const cfg = loadConfig();
    repository = new DocumentsRepository(
      cfg?.documents?.dbPath ?? path.join(getConfigDir(), "documents.sqlite"),
    );
  }
  return repository;
}

export function getDocumentIngestService(): DocumentIngestService {
  if (!ingestService) {
    const cfg = loadConfig();
    // MVP: vision-ключ не сконфигурирован → StubExtractor (честный needsReview).
    const hasVisionKey = Boolean(cfg?.models?.vision?.apiKey ?? cfg?.apiKey);
    ingestService = new DocumentIngestService(
      getDocumentsRepository(),
      createExtractor(cfg?.documents, hasVisionKey, buildVisionOcr()),
    );
  }
  return ingestService;
}

export { DocumentsRepository } from "./DocumentsRepository.js";
export { DocumentIngestService, documentAck } from "./DocumentIngestService.js";
export { maybeIngestDocument } from "./telegram.js";
export { ChatArchiveService, archiveFromTelegram } from "./chat-archive.js";
export type { ChatArchiveRecord, ArchiveKind } from "./chat-archive.js";
export {
  ListenerMediaPipeline,
  jobToListenerInput,
  processMediaRetryJob,
} from "./ListenerMediaPipeline.js";
export type { ListenerMediaInput, ListenerMediaResult } from "./ListenerMediaPipeline.js";
export type { TelegramFileMessage } from "./DocumentIngestService.js";
export type { ExpenseDocument, ExpensesQuery, ExpensesQueryResult } from "./types.js";

/** Архивариус (listen_only): тот же repository + extractor, что и расходы. */
export function getChatArchiveService(): ChatArchiveService {
  if (!archiveService) {
    const cfg = loadConfig();
    const hasVisionKey = Boolean(cfg?.models?.vision?.apiKey ?? cfg?.apiKey);
    archiveService = new ChatArchiveService(
      getDocumentsRepository(),
      createExtractor(cfg?.documents, hasVisionKey, buildVisionOcr()),
    );
  }
  return archiveService;
}

/** Полный listen-only конвейер: download → OCR → archive → structured ingest. */
export function getListenerMediaPipeline(): ListenerMediaPipeline {
  if (!listenerPipeline) {
    const cfg = loadConfig();
    const hasVisionKey = Boolean(cfg?.models?.vision?.apiKey ?? cfg?.apiKey);
    const token = cfg?.telegram?.botToken;
    listenerPipeline = new ListenerMediaPipeline(
      getDocumentsRepository(),
      createExtractor(cfg?.documents, hasVisionKey, buildVisionOcr()),
      async (fileId) => {
        if (!token) throw new Error("no botToken");
        const fs = await import("node:fs/promises");
        const dest = `${getConfigDir()}/tmp-listener-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await fs.mkdir(path.dirname(dest), { recursive: true });
        // Скачивание через общий resilient-слой (как в telegram-bot/index.ts).
        const { downloadTelegramFileToDisk } = await import(
          "../../utils/telegram/telegram-files.js"
        );
        return downloadTelegramFileToDisk(token, fileId, dest);
      },
    );
  }
  return listenerPipeline;
}
