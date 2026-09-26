/**
 * Backfill: перепарс существующих чеков из сохранённого rawText (OCR).
 *
 * Использует ТЕ ЖЕ детерминированные функции parse*, что и intake, поэтому
 * результат консистентен с новыми чеками. Без UI Telegram — вызываемая функция
 * (+ unit-тест на фикстурах). Старые записи без raw_text пропускаются.
 */
import type { DocumentsRepository } from "./DocumentsRepository.js";
import {
  parseTotalFromText,
  parseDateFromText,
  parseSupplierFromText,
  parseItemsFromText,
  computeNeedsReview,
} from "./extractors/parsers.js";

export interface BackfillChange {
  id: string;
  before: {
    supplier: string | null;
    total: number | null;
    docDate: string;
    needsReview: boolean;
    itemsJson: string | null;
  };
  after: {
    supplier: string | null;
    total: number | null;
    docDate: string;
    needsReview: boolean;
    itemsJson: string | null;
  };
  changed: boolean;
}

export interface BackfillResult {
  dryRun: boolean;
  /** Сколько строк просмотрено (кандидаты с raw_text). */
  scanned: number;
  /** Сколько строк реально изменилось (в dryRun — сколько бы изменилось). */
  changed: number;
  changes: BackfillChange[];
}

export interface BackfillOptions {
  /** true — только отчёт «что изменится», без записи в БД. */
  dryRun?: boolean;
  /** размер батча (default 50, max 200). */
  limit?: number;
}

/**
 * Перепарсить кандидатов (needs_review OR total IS NULL) из raw_text.
 * Не удаляет строки; не трогает archive. Возвращает отчёт изменений.
 */
export function reparseExpenseFromRaw(
  repo: DocumentsRepository,
  opts: BackfillOptions = {},
): BackfillResult {
  const dryRun = opts.dryRun ?? false;
  const candidates = repo.listBackfillCandidates(opts.limit ?? 50);

  const changes: BackfillChange[] = [];
  let changedCount = 0;

  for (const doc of candidates) {
    const rawText = (doc.rawText ?? "").trim();
    if (!rawText) continue; // без OCR-текста не перепарсиваем

    const total = parseTotalFromText(rawText);
    const parsedDate = parseDateFromText(rawText);
    const supplier = parseSupplierFromText(rawText);
    const items = parseItemsFromText(rawText);
    const needsReview = computeNeedsReview({
      total,
      supplier,
      docDate: parsedDate,
      items,
      rawText,
    });

    const before = {
      supplier: doc.supplier ?? null,
      total: doc.total ?? null,
      docDate: doc.docDate,
      needsReview: doc.needsReview,
      itemsJson: doc.itemsJson ?? null,
    };
    const after = {
      supplier: supplier ?? null,
      total: total ?? null,
      docDate: parsedDate ?? doc.docDate,
      needsReview,
      itemsJson: items.length > 0 ? JSON.stringify(items) : null,
    };

    const changed =
      before.supplier !== after.supplier ||
      before.total !== after.total ||
      before.docDate !== after.docDate ||
      before.needsReview !== after.needsReview ||
      before.itemsJson !== after.itemsJson;

    if (changed) {
      changedCount += 1;
      if (!dryRun) {
        repo.fillExpenseDocument(doc.id, {
          supplier: after.supplier,
          total: after.total,
          docDate: after.docDate,
          itemsJson: after.itemsJson,
          needsReview: needsReview ? 1 : 0,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    changes.push({ id: doc.id, before, after, changed });
  }

  return {
    dryRun,
    scanned: candidates.length,
    changed: changedCount,
    changes,
  };
}
