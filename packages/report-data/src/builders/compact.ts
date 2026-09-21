/**
 * Compact-отчёт: сводка + поставщики + плоские документы.
 */
import type { CompactExpenseReport, ExpenseRow } from "../types.js";
import { aggregateSuppliers, buildSummary } from "./aggregate.js";

export interface ReportMeta {
  chatId: string;
  groupTitle: string | null;
  period: { fromDate: string | null; toDate: string | null; fullHistory: boolean };
}

export function buildCompactReport(rows: ExpenseRow[], meta: ReportMeta): CompactExpenseReport {
  return {
    format: "compact",
    chatId: meta.chatId,
    groupTitle: meta.groupTitle,
    period: meta.period,
    summary: buildSummary(rows),
    suppliers: aggregateSuppliers(rows),
    documents: rows.map((r) => ({
      id: r.id,
      docDate: r.docDate,
      supplier: r.supplier ?? null,
      total: r.total ?? null,
      currency: r.currency || "RUB",
      needsReview: r.needsReview,
    })),
  };
}
