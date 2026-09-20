/**
 * Типы данных для шаблона expense-report (развёртка чеков с позициями).
 * LLM/agent отдаёт только данные; layout строит пакет.
 */

export interface ExpenseLineItem {
  name: string;
  /** "2 шт", "45 м" — уже отформатировано или число + формат в builder. */
  qtyLabel: string;
  /** "178,00" — уже отформатировано. */
  amountLabel: string;
}

export interface ExpenseReceiptBlock {
  /** "Чек №1 · Магнит" */
  title: string;
  /** "12.09.2026 · файл: ..." */
  meta: string;
  /** "507,99 ₽" */
  totalLabel: string;
  items: ExpenseLineItem[];
}

export interface ExpenseSupplierRow {
  supplier: string;
  receiptCount: number;
  totalLabel: string;
}

export interface ExpenseReportInput {
  groupTitle: string;
  periodLabel: string;
  generatedAtLabel: string;
  summary: {
    documents: number;
    suppliers: number;
    lineItems: number;
    totalLabel: string;
  };
  suppliers: ExpenseSupplierRow[];
  receipts: ExpenseReceiptBlock[];
  /** default "₽" */
  currency?: string;
}
