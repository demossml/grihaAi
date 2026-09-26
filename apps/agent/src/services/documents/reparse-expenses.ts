/**
 * Backfill: переразбор expense_documents из сохранённого OCR rawText.
 *
 * Новые правила парсера (ИТОГО-якоря, reject ИНН, диапазон дат, needsReview)
 * применяются к старым чекам без повторной загрузки фото из Telegram. Тот же
 * parse-пайплайн (`parseReceiptFromText`), что у intake новых фото.
 */
import path from "node:path";
import { getConfigDir, loadConfig } from "@griha/config";
import { DocumentsRepository } from "./DocumentsRepository.js";
import { parseReceiptFromText } from "./extractors/parsers.js";

export interface ReparseOptions {
  /** только needsReview / total null / suspicious — default true. */
  onlyProblematic?: boolean;
  /** лимит документов за запуск. */
  limit?: number;
  /** опциональный фильтр по чату. */
  chatId?: string;
  /** ничего не писать в БД. */
  dryRun?: boolean;
}

export interface ReparseBeforeAfter {
  total?: number | null;
  supplier?: string | null;
  date?: string | null;
  needsReview?: boolean;
}

export interface ReparseItemResult {
  id: string;
  chatId?: string;
  action: "updated" | "skipped" | "unchanged" | "error";
  reason?: string;
  before?: ReparseBeforeAfter;
  after?: ReparseBeforeAfter;
}

export interface ReparseSummary {
  scanned: number;
  updated: number;
  skipped: number;
  unchanged: number;
  errors: number;
  items: ReparseItemResult[]; // cap 100
}

/** Путь documents.sqlite (config override → default ~/.grish-ai/documents.sqlite). */
export function resolveDocumentsDbPath(): string {
  try {
    const cfg = loadConfig();
    if (cfg?.documents?.dbPath) return cfg.documents.dbPath;
  } catch {
    /* fallthrough */
  }
  return path.join(getConfigDir(), "documents.sqlite");
}

const MAX_ITEMS_IN_SUMMARY = 100;

function toBeforeAfter(doc: {
  total?: number;
  supplier?: string;
  docDate: string;
  needsReview: boolean;
  itemsJson?: string;
}): { before: ReparseBeforeAfter; itemsJson: string | null } {
  return {
    before: {
      total: doc.total ?? null,
      supplier: doc.supplier ?? null,
      date: doc.docDate ?? null,
      needsReview: doc.needsReview,
    },
    itemsJson: doc.itemsJson ?? null,
  };
}

/**
 * Переразобрать expense_documents по новым правилам парсера. Открывает ту же
 * БД, что и production DocumentsRepository. Не вызывает Telegram API, не
 * скачивает фото: нужен сохранённый OCR text (expense.raw_text или archive).
 */
export async function reparseExpenses(
  opts: ReparseOptions = {},
  repo?: DocumentsRepository,
): Promise<ReparseSummary> {
  const repository = repo ?? new DocumentsRepository(resolveDocumentsDbPath());
  const onlyProblematic = opts.onlyProblematic ?? true;
  const limit = opts.limit ?? 50;
  const dryRun = opts.dryRun ?? false;

  const candidates = repository.listReparseCandidates({
    onlyProblematic,
    chatId: opts.chatId,
    limit,
  });

  const summary: ReparseSummary = {
    scanned: candidates.length,
    updated: 0,
    skipped: 0,
    unchanged: 0,
    errors: 0,
    items: [],
  };

  for (const doc of candidates) {
    const id = doc.id;
    const chatId = doc.chatId;

    // rawText: expense.raw_text → fallback archive по file_unique_id.
    let rawText = (doc.rawText ?? "").trim();
    if (!rawText && doc.fileUniqueId) {
      try {
        rawText = (
          repository.findArchiveByFileUniqueId(doc.chatId, doc.fileUniqueId)?.rawText ?? ""
        ).trim();
      } catch {
        rawText = "";
      }
    }

    if (!rawText) {
      summary.skipped += 1;
      summary.items.push({ id, chatId, action: "skipped", reason: "no_raw_text" });
      continue;
    }

    const { before, itemsJson: itemsJsonBefore } = toBeforeAfter(doc);

    let after: ReparseBeforeAfter;
    let itemsJsonAfter: string | null;
    try {
      const parsed = parseReceiptFromText(rawText);
      itemsJsonAfter = parsed.items?.length ? JSON.stringify(parsed.items) : null;
      after = {
        total: parsed.total ?? null,
        supplier: parsed.supplier ?? null,
        date: parsed.docDate ?? doc.docDate,
        needsReview: parsed.needsReview,
      };
    } catch (err) {
      summary.errors += 1;
      summary.items.push({
        id,
        chatId,
        action: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const changed =
      before.total !== after.total ||
      before.supplier !== after.supplier ||
      before.date !== after.date ||
      before.needsReview !== after.needsReview ||
      itemsJsonBefore !== itemsJsonAfter;

    if (!changed) {
      summary.unchanged += 1;
      summary.items.push({ id, chatId, action: "unchanged", before, after });
      continue;
    }

    if (dryRun) {
      summary.updated += 1; // «обновился бы», но БД не трогаем
      summary.items.push({ id, chatId, action: "updated", before, after });
      continue;
    }

    try {
      const ok = repository.fillExpenseDocument(id, {
        supplier: after.supplier,
        total: after.total,
        docDate: after.date ?? doc.docDate,
        itemsJson: itemsJsonAfter,
        needsReview: after.needsReview ? 1 : 0,
        updatedAt: new Date().toISOString(),
      });
      if (!ok) {
        summary.errors += 1;
        summary.items.push({ id, chatId, action: "error", reason: "update failed (row missing)" });
        continue;
      }
      summary.updated += 1;
      summary.items.push({ id, chatId, action: "updated", before, after });
    } catch (err) {
      summary.errors += 1;
      summary.items.push({
        id,
        chatId,
        action: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (summary.items.length > MAX_ITEMS_IN_SUMMARY) {
    summary.items = summary.items.slice(0, MAX_ITEMS_IN_SUMMARY);
  }

  return summary;
}
