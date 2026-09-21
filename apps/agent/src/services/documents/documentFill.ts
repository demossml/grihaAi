/**
 * document_fill: дозаполнение проблемных чеков (запись в expense_documents).
 * Read остаётся в @griha/report-data; здесь только write + tool.
 */
import type { DocumentsRepository } from "./DocumentsRepository.js";

export interface DocumentFillPatch {
  /** id из report_data_problems / expense_documents.id */
  expenseId: string;
  supplier?: string;
  total?: number;
  /** YYYY-MM-DD */
  docDate?: string;
  currency?: string;
  /** Полная замена позиций. undefined — не трогаем items_json; [] — пустой массив. */
  items?: Array<{ name: string; qty?: number; sum?: number }>;
  /** Дописать в raw_text с префиксом [manual] */
  note?: string;
}

export type DocumentFillResult =
  | {
      ok: true;
      expenseId: string;
      chatId: string;
      before: {
        supplier: string | null;
        total: number | null;
        docDate: string;
        needsReview: boolean;
      };
      after: {
        supplier: string | null;
        total: number | null;
        docDate: string;
        needsReview: boolean;
        currency: string;
      };
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "DENY"
        | "CHAT_MISMATCH"
        | "MISSING_CHAT_ID"
        | "INVALID_INPUT"
        | "INTERNAL";
      message: string;
    };

export function validatePatch(patch: DocumentFillPatch): string | null {
  if (!patch.expenseId?.trim()) return "expenseId обязателен";
  if (patch.total !== undefined) {
    if (typeof patch.total !== "number" || Number.isNaN(patch.total) || patch.total < 0) {
      return "total должен быть числом >= 0";
    }
  }
  if (patch.docDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.docDate)) {
    return "docDate должен быть YYYY-MM-DD";
  }
  if (patch.items !== undefined) {
    if (!Array.isArray(patch.items)) return "items должен быть массивом";
    for (const it of patch.items) {
      if (!it || typeof it.name !== "string" || !it.name.trim()) {
        return "каждая позиция items должна иметь name";
      }
    }
  }
  if (
    patch.supplier === undefined &&
    patch.total === undefined &&
    patch.docDate === undefined &&
    patch.currency === undefined &&
    patch.items === undefined &&
    patch.note === undefined
  ) {
    return "Нет полей для обновления";
  }
  return null;
}

export async function fillExpenseDocumentService(
  patch: DocumentFillPatch,
  deps: {
    repo: DocumentsRepository;
    /** финальный chatId после scope — документ должен принадлежать этому чату */
    expectedChatId: string;
  },
): Promise<DocumentFillResult> {
  const err = validatePatch(patch);
  if (err) return { ok: false, code: "INVALID_INPUT", message: err };

  const existing = deps.repo.getExpenseById(patch.expenseId.trim());
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Документ не найден." };
  }
  if (String(existing.chatId) !== String(deps.expectedChatId)) {
    return {
      ok: false,
      code: "CHAT_MISMATCH",
      message: "Документ принадлежит другой группе.",
    };
  }

  const updatedAt = new Date().toISOString();
  let rawText = existing.rawText;
  if (patch.note?.trim()) {
    const line = `[manual ${updatedAt.slice(0, 10)}] ${patch.note.trim()}`;
    rawText = rawText ? `${rawText}\n${line}` : line;
  }

  const newTotal = patch.total !== undefined ? patch.total : existing.total;
  const needsReview = newTotal == null ? 1 : 0;

  const itemsJson = patch.items !== undefined ? JSON.stringify(patch.items) : undefined;

  const ok = deps.repo.fillExpenseDocument(existing.id, {
    supplier: patch.supplier !== undefined ? patch.supplier.trim() : undefined,
    total: patch.total,
    docDate: patch.docDate,
    currency: patch.currency,
    itemsJson,
    rawText: patch.note !== undefined ? rawText : undefined,
    needsReview,
    updatedAt,
  });

  if (!ok) {
    return { ok: false, code: "INTERNAL", message: "UPDATE failed" };
  }

  const after = deps.repo.getExpenseById(existing.id)!;
  return {
    ok: true,
    expenseId: existing.id,
    chatId: existing.chatId,
    before: {
      supplier: existing.supplier ?? null,
      total: existing.total ?? null,
      docDate: existing.docDate,
      needsReview: existing.needsReview,
    },
    after: {
      supplier: after.supplier ?? null,
      total: after.total ?? null,
      docDate: after.docDate,
      needsReview: after.needsReview,
      currency: after.currency,
    },
  };
}
