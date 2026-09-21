/**
 * Expanded-отчёт: как compact, но documents с items + rawTextPreview.
 */
import type { ExpandedExpenseReport, ExpenseRow, ReportExpenseItem } from "../types.js";
import { aggregateSuppliers, buildSummary } from "./aggregate.js";
import { parseItemsJson, previewText } from "../format.js";
import type { ReportMeta } from "./compact.js";

export function buildExpandedReport(rows: ExpenseRow[], meta: ReportMeta): ExpandedExpenseReport {
  const documents: ReportExpenseItem[] = rows.map((r) => ({
    id: r.id,
    docDate: r.docDate,
    supplier: r.supplier ?? null,
    total: r.total ?? null,
    currency: r.currency || "RUB",
    needsReview: r.needsReview,
    fileName: r.fileName ?? null,
    items: parseItemsJson(r.itemsJson),
    rawTextPreview: previewText(r.rawText),
  }));
  return {
    format: "expanded",
    chatId: meta.chatId,
    groupTitle: meta.groupTitle,
    period: meta.period,
    summary: buildSummary(rows),
    suppliers: aggregateSuppliers(rows),
    documents,
  };
}
