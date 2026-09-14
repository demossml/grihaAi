/**
 * E3: канонический источник данных PDF-отчёта по расходам.
 *
 * Данные строятся из ФАКТА БД (`expense_documents`, тот же источник, что у
 * текстового эталона `expenses_sum`), а не из «пустого объекта LLM».
 * Никакого хардкода названий групп/чат-айди: scope — chatId/threadId из
 * контекста сессии.
 */
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseReportData } from "../../utils/reports/report-schemas.js";

export interface ExpenseReportSourceInput {
  /** Чат, по которому строится отчёт (обычно из контекста сессии). */
  chatId?: string;
  /** Тема форума (scope=thread); отсутствует → весь чат. */
  threadId?: string;
  /** Метка периода для заголовка/подписи (например, «весь период»). */
  period?: string;
  fromDate?: string;
  toDate?: string;
}

export type ExpenseReportBuildResult =
  | { ok: true; data: ExpenseReportData; periodLabel: string }
  | { ok: false; error: string };

export const EXPENSE_REPORT_EMPTY_MESSAGE = "Нет данных для PDF-отчёта.";

/** E3: построить данные expense-отчёта из БД (items + категории + итог). */
export async function buildExpenseReportData(
  repo: DocumentsRepository,
  input: ExpenseReportSourceInput,
): Promise<ExpenseReportBuildResult> {
  const chatId = input.chatId?.trim();
  if (!chatId) {
    return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };
  }

  const result = await repo.query({
    chatId,
    threadId: input.threadId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    limit: 200,
  });
  if (result.count === 0) {
    return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };
  }

  const items = result.documents.map((d) => ({
    date: d.docDate,
    category: d.supplier ?? "без категории",
    description: d.fileName ?? "",
    amount: d.total ?? 0,
  }));

  const bySupplier = new Map<string, number>();
  for (const d of result.documents) {
    const key = d.supplier ?? "без категории";
    bySupplier.set(key, (bySupplier.get(key) ?? 0) + (d.total ?? 0));
  }
  const categories = [...bySupplier.entries()].map(([name, amount]) => ({
    name,
    amount,
  }));

  const periodLabel =
    input.period && input.period.trim() ? input.period : "весь период";

  return {
    ok: true,
    periodLabel,
    data: {
      period: periodLabel,
      totalAmount: result.totalSum,
      categories,
      items,
    },
  };
}
