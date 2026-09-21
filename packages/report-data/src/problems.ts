/**
 * Классификация проблемных чеков (без I/O).
 */
import type { ExpenseRow, ProblemExpenseItem, ProblemReason } from "./types.js";
import { previewText } from "./format.js";

export function classifyProblem(row: ExpenseRow): ProblemReason[] {
  const reasons: ProblemReason[] = [];
  if (row.total == null || Number.isNaN(row.total)) reasons.push("missing_total");
  if (row.needsReview) reasons.push("needs_review");
  if (!row.rawText || !row.rawText.trim()) reasons.push("empty_raw_text");
  if (row.kind === "unknown") reasons.push("unknown_kind");
  if (typeof row.confidence === "number" && row.confidence > 0 && row.confidence < 0.5) {
    reasons.push("parse_low_confidence");
  }
  return reasons;
}

export function toProblemItem(row: ExpenseRow): ProblemExpenseItem | null {
  const reasons = classifyProblem(row);
  if (reasons.length === 0) return null;
  const suggested: ProblemExpenseItem["suggestedFields"] = [];
  if (reasons.includes("missing_total")) suggested.push("total");
  if (!row.supplier) suggested.push("supplier");
  if (!row.docDate) suggested.push("docDate");
  if (!row.itemsJson) suggested.push("items");
  return {
    id: row.id,
    docDate: row.docDate,
    supplier: row.supplier ?? null,
    total: row.total ?? null,
    currency: row.currency || "RUB",
    reasons,
    fileName: row.fileName ?? null,
    messageId: row.messageId ?? null,
    rawTextPreview: previewText(row.rawText),
    suggestedFields: suggested,
  };
}
