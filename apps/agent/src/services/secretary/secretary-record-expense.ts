/**
 * R5 — явная запись расхода «Гриша, запиши …» (без LLM).
 * paymentPurpose из фиксированного словаря; needsReview=false (явное поручение).
 * Пишет в существующий expense_documents (тот же источник, что у отчётов).
 */
import { randomUUID } from "node:crypto";
import type { DocumentsRepository } from "../documents/DocumentsRepository.js";
import type { ExpenseDocument } from "../documents/types.js";

export const PAYMENT_PURPOSES = [
  "materials",
  "equipment",
  "services",
  "rent",
  "utilities",
  "taxes",
  "collection",
  "salary",
  "household",
  "transport",
  "repair",
  "advertising",
  "refund",
  "accountable",
  "other",
] as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export function isPaymentPurpose(v: string): v is PaymentPurpose {
  return (PAYMENT_PURPOSES as readonly string[]).includes(v);
}

/** Нормализовать ввод: неизвестное значение → "other". */
export function normalizePaymentPurpose(v: string | undefined): PaymentPurpose {
  if (v && isPaymentPurpose(v)) return v;
  return "other";
}

export interface SecretaryRecordExpenseInput {
  chatId: string;
  amount?: number;
  currency?: string;
  supplier?: string;
  paymentPurpose: string;
  note?: string;
  sourceMessageId?: string;
  docDate?: string; // YYYY-MM-DD; default — сегодня
}

export async function recordSecretaryExpense(
  repo: DocumentsRepository,
  input: SecretaryRecordExpenseInput,
  fromUserId?: string,
): Promise<ExpenseDocument> {
  const now = new Date().toISOString();
  const doc: ExpenseDocument = {
    id: randomUUID(),
    chatId: input.chatId,
    messageId: input.sourceMessageId,
    fromUserId,
    kind: "unknown", // ручная запись, не распознанный документ
    docDate: input.docDate ?? now.slice(0, 10),
    supplier: input.supplier,
    total: input.amount,
    currency: input.currency || "RUB",
    rawText: input.note,
    paymentPurpose: normalizePaymentPurpose(input.paymentPurpose),
    confidence: 1,
    needsReview: false,
    source: "secretary",
    createdAt: now,
    updatedAt: now,
  };
  return repo.insert(doc);
}
