/**
 * D5: ExpensesReader поверх DocumentsRepository (read-only, без изменения схемы БД).
 * Маппит полные ExpenseDocument → ExpenseRow для @griha/report-data.
 */
import type { ExpenseRow, ExpensesReader } from "@griha/report-data";
import type { DocumentsRepository } from "./DocumentsRepository.js";

export function createDocumentsExpensesReader(repo: DocumentsRepository): ExpensesReader {
  return {
    async listExpenses(q): Promise<ExpenseRow[]> {
      const docs = repo.listExpenseRowsForReport({
        chatId: q.chatId,
        threadId: q.threadId,
        fromDate: q.fromDate,
        toDate: q.toDate,
        limit: q.limit,
      });
      return docs.map((d) => ({
        id: d.id,
        chatId: d.chatId,
        threadId: d.threadId ?? null,
        messageId: d.messageId ?? null,
        docDate: d.docDate,
        supplier: d.supplier ?? null,
        total: d.total ?? null,
        currency: d.currency,
        rawText: d.rawText ?? null,
        itemsJson: d.itemsJson ?? null,
        confidence: d.confidence,
        needsReview: d.needsReview,
        fileName: d.fileName ?? null,
        kind: d.kind ?? null,
      }));
    },
  };
}
