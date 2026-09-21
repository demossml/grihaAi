/**
 * @griha/report-data — типы данных отчёта по расходам (без PDF/Telegram/LLM).
 * Чистые DTO, источник данных — ExpensesReader (inject).
 */

export type ReportDataFormat = "compact" | "expanded";

export interface ReportPeriod {
  fromDate?: string;
  toDate?: string;
}

export interface ReportDataRequest {
  chatId: string;
  period?: ReportPeriod;
  format: ReportDataFormat;
  threadId?: string;
  groupTitle?: string | null;
}

export interface ReportLineItem {
  name: string;
  qty?: number;
  sum?: number;
}

export interface ReportExpenseItem {
  id: string;
  docDate: string;
  supplier: string | null;
  total: number | null;
  currency: string;
  needsReview: boolean;
  fileName: string | null;
  items?: ReportLineItem[];
  rawTextPreview?: string | null;
}

export interface ReportSupplierAgg {
  supplier: string;
  documentCount: number;
  total: number;
  currency: string;
}

export type ProblemReason =
  | "missing_total"
  | "needs_review"
  | "empty_raw_text"
  | "unknown_kind"
  | "parse_low_confidence";

export interface ProblemExpenseItem {
  id: string;
  docDate: string;
  supplier: string | null;
  total: number | null;
  currency: string;
  reasons: ProblemReason[];
  fileName: string | null;
  messageId: string | null;
  rawTextPreview: string | null;
  suggestedFields: Array<"supplier" | "total" | "docDate" | "items">;
}

export interface CompactExpenseReport {
  format: "compact";
  chatId: string;
  groupTitle: string | null;
  period: { fromDate: string | null; toDate: string | null; fullHistory: boolean };
  summary: {
    documentCount: number;
    withTotalCount: number;
    totalSum: number;
    currency: string;
    problemCount: number;
  };
  suppliers: ReportSupplierAgg[];
  documents: Array<{
    id: string;
    docDate: string;
    supplier: string | null;
    total: number | null;
    currency: string;
    needsReview: boolean;
  }>;
}

export interface ExpandedExpenseReport {
  format: "expanded";
  chatId: string;
  groupTitle: string | null;
  period: { fromDate: string | null; toDate: string | null; fullHistory: boolean };
  summary: CompactExpenseReport["summary"];
  suppliers: ReportSupplierAgg[];
  documents: ReportExpenseItem[];
}

export interface ProblemsListResult {
  chatId: string;
  groupTitle: string | null;
  period: { fromDate: string | null; toDate: string | null; fullHistory: boolean };
  count: number;
  items: ProblemExpenseItem[];
}

export type ReportDataResult =
  | { ok: true; report: CompactExpenseReport | ExpandedExpenseReport }
  | { ok: false; code: "MISSING_CHAT_ID" | "INVALID_PERIOD" | "NO_DATA" | "INTERNAL"; message: string };

export type ProblemsResult =
  | { ok: true; problems: ProblemsListResult }
  | { ok: false; code: "MISSING_CHAT_ID" | "INVALID_PERIOD" | "INTERNAL"; message: string };

export interface ExpenseRow {
  id: string;
  chatId: string;
  threadId?: string | null;
  messageId?: string | null;
  docDate: string;
  supplier?: string | null;
  total?: number | null;
  currency: string;
  rawText?: string | null;
  itemsJson?: string | null;
  confidence: number;
  needsReview: boolean;
  fileName?: string | null;
  kind?: string | null;
}

export interface ExpensesReader {
  listExpenses(q: {
    chatId: string;
    threadId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
  }): Promise<ExpenseRow[]>;
}
