/**
 * documents/index — синглтоны + точка входа сервиса документов/расходов.
 */
import path from "node:path";
import { getConfigDir, loadConfig } from "@griha/config";
import { DocumentsRepository } from "./DocumentsRepository.js";
import { DocumentIngestService } from "./DocumentIngestService.js";
import { createExtractor } from "./extractors/types.js";

let repository: DocumentsRepository | null = null;
let ingestService: DocumentIngestService | null = null;

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
      createExtractor(cfg?.documents, hasVisionKey),
    );
  }
  return ingestService;
}

export { DocumentsRepository } from "./DocumentsRepository.js";
export { DocumentIngestService, documentAck } from "./DocumentIngestService.js";
export { maybeIngestDocument } from "./telegram.js";
export type { TelegramFileMessage } from "./DocumentIngestService.js";
export type { ExpenseDocument, ExpensesQuery, ExpensesQueryResult } from "./types.js";
