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
  confidence: number; // 0..1
  needsReview: boolean;
  source: "telegram";
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
  /** default 50 for list; «весь период» (без дат) может доходить до 10 000 */
  limit?: number;
}

export interface ExpensesQueryResult {
  ok: true;
  count: number;
  totalSum: number;
  currency: string;
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
  }>;
  note?: string;
}
