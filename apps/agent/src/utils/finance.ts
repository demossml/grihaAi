import type { Expense } from "../types/index.js";

/**
 * Finance helpers — deterministic logic. The LLM only fills gaps; totals and
 * categorization precedence live here.
 */

export interface CategorizationResult {
  category?: string;
  confidence: number;
  needsConfirmation: boolean;
  reason: string;
}

export interface CategorizationHistoryEntry {
  vendor: string;
  category: string;
}

/**
 * Categorization precedence:
 *   1. user rules (handled by the caller/skill before this function);
 *   2. previously confirmed vendor→category history (exact match, high confidence);
 *   3. partial/substring match (low confidence → requires confirmation);
 *   4. otherwise → ask.
 *
 * A single "Uber → Transport" mapping never auto-applies to unrelated similar
 * vendors — only exact-history matches are high confidence.
 */
export function categorizeTransaction(
  vendor: string,
  history: CategorizationHistoryEntry[],
): CategorizationResult {
  const normalized = vendor.trim().toLowerCase();
  if (!normalized) return { confidence: 0, needsConfirmation: true, reason: "empty vendor" };

  const exact = history.find((h) => h.vendor.trim().toLowerCase() === normalized);
  if (exact) {
    return {
      category: exact.category,
      confidence: 0.9,
      needsConfirmation: false,
      reason: `known vendor (${exact.category})`,
    };
  }

  const partial = history.find(
    (h) =>
      h.vendor.trim().toLowerCase().includes(normalized) ||
      normalized.includes(h.vendor.trim().toLowerCase()),
  );
  if (partial) {
    return {
      category: partial.category,
      confidence: 0.5,
      needsConfirmation: true,
      reason: `similar vendor "${partial.vendor}" — confirm category`,
    };
  }

  return { confidence: 0, needsConfirmation: true, reason: "unknown vendor — ask user" };
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Record<string, number>;
  byVendor: Record<string, number>;
}

export function summarizeExpenses(expenses: Expense[]): ExpenseSummary {
  const summary: ExpenseSummary = { total: 0, count: 0, byCategory: {}, byVendor: {} };
  for (const e of expenses) {
    if (!Number.isFinite(e.amount)) continue;
    summary.total += e.amount;
    summary.count += 1;
    const category = e.category ?? "uncategorized";
    summary.byCategory[category] = (summary.byCategory[category] ?? 0) + e.amount;
    const vendor = e.vendor ?? "unknown";
    summary.byVendor[vendor] = (summary.byVendor[vendor] ?? 0) + e.amount;
  }
  return summary;
}

export interface PeriodComparison {
  currentTotal: number;
  previousTotal: number;
  delta: number;
  deltaPct: number | null;
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  const delta = current - previous;
  const deltaPct = previous !== 0 ? (delta / Math.abs(previous)) * 100 : null;
  return { currentTotal: current, previousTotal: previous, delta, deltaPct };
}

export interface OcrExpense {
  vendor?: string;
  amount?: number;
  currency?: string;
  date?: string;
  /** Fields the OCR text did not provide confidently. */
  missing: string[];
}

const AMOUNT_RE = /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(₽|RUB|USD|EUR|\$|€)/i;

/**
 * Best-effort, conservative OCR extraction for expense intake. Never guesses:
 * missing critical fields are reported so the agent asks the user.
 */
export function parseExpenseFromOcr(text: string): OcrExpense {
  const missing: string[] = [];
  const result: OcrExpense = { missing };

  const amountMatch = text.match(AMOUNT_RE);
  if (amountMatch) {
    result.amount = Number(amountMatch[1].replace(/\s/g, "").replace(",", "."));
    result.currency = normalizeCurrency(amountMatch[2]);
    if (!Number.isFinite(result.amount)) {
      result.amount = undefined;
      missing.push("amount");
    }
  } else {
    missing.push("amount");
  }

  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  if (firstLine && firstLine.length <= 60 && !AMOUNT_RE.test(firstLine)) {
    result.vendor = firstLine;
  } else {
    missing.push("vendor");
  }

  const dateMatch = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  if (dateMatch) result.date = dateMatch[1];
  else missing.push("date");

  return result;
}

function normalizeCurrency(token: string): string {
  switch (token.toUpperCase()) {
    case "₽":
    case "RUB":
      return "RUB";
    case "$":
    case "USD":
      return "USD";
    case "€":
    case "EUR":
      return "EUR";
    default:
      return token.toUpperCase();
  }
}
