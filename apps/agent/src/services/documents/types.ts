/**
 * Documents / Expenses MVP — типы.
 * Scope = chat: документ всегда привязан к chatId (+fromUserId).
 * Query по умолчанию — вся история чата (без фильтра дат).
 */

export type DocumentKind = "receipt" | "invoice" | "waybill" | "unknown";

export interface ExpenseDocument {
  id: string;
  chatId: string;
  /** Тема форума (message_thread_id); NULL/undefined = не тема. */
  threadId?: string;
  messageId?: string;
  fromUserId?: string;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  kind: DocumentKind;
  /** YYYY-MM-DD */
  docDate: string;
  supplier?: string;
  total?: number;
  currency: string; // default "RUB"
  rawText?: string;
  itemsJson?: string;
  /** R5: назначение платежа из словаря secretary (materials/services/…). */
  paymentPurpose?: string;
  confidence: number; // 0..1
  needsReview: boolean;
  source: "telegram" | "secretary";
  createdAt: string;
  updatedAt: string;
}

export interface ExpensesQuery {
  /** default: текущий чат */
  chatId?: string;
  /** NEW: если задан — только документы этой темы; иначе — весь чат. */
  threadId?: string;
  /** подстрока, case-insensitive */
  supplier?: string;
  /** OPTIONAL YYYY-MM-DD inclusive */
  fromDate?: string;
  /** OPTIONAL YYYY-MM-DD inclusive */
  toDate?: string;
  /** default 50 for list, max 200 */
  limit?: number;
}

export interface ExpensesQueryResult {
  ok: true;
  /** Количество документов на странице (после LIMIT). */
  count: number;
  /** Полное число совпавших документов (без LIMIT). */
  totalCount: number;
  /** Legacy: сумма только при одной валюте; иначе 0 (см. totalsByCurrency). */
  totalSum: number;
  currency: string;
  /** Суммы по каждой валюте — никогда не смешиваем USD+RUB в одно число. */
  totalsByCurrency: Record<string, number>;
  /** true когда totalCount > размер страницы. */
  truncated: boolean;
  /** true когда fromDate/toDate не применялись */
  fullHistory: boolean;
  documents: Array<{
    id: string;
    docDate: string;
    supplier?: string;
    total?: number;
    currency: string;
    needsReview: boolean;
    fileName?: string;
    items?: Array<{ name: string; qty?: number; sum?: number }>;
  }>;
  note?: string;
}
