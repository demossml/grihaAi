/**
 * expenses_report_pdf — DB-backed отчёт по расходам (R4/R5).
 *
 * Данные НИКОГДА не берутся из LLM-схемы: всегда `repo.query` по chatId/threadId
 * и датам. «Весь период» = без дат → лимит 10 000 (все записи). Итог = SUM по
 * всем строкам. Результат — путь к PDF + dedupeKey (идемпотентность).
 */
import { renderExpensePdfRussian } from "../../utils/reports/russian-pdf.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";

export interface ExpenseReportPdfArgs {
  chatId?: string;
  threadId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ExpenseReportPdfContext {
  /** Текущий чат сессии (default). */
  chatId?: string;
  /** Actor user id. */
  userId?: string;
  canManage?: (userId: string) => Promise<boolean>;
}

export interface ExpenseReportAttachment {
  filePath: string;
  caption: string;
  dedupeKey: string;
  totalAmount: number;
  count: number;
}

export async function buildExpenseReportAttachment(
  args: ExpenseReportPdfArgs,
  ctx: ExpenseReportPdfContext,
  repo: DocumentsRepository,
): Promise<{ error: string } | ExpenseReportAttachment> {
  const current = ctx.chatId;
  const requested = args.chatId;
  if (requested && current && requested !== current) {
    const actor = ctx.userId ?? "";
    const allowed = ctx.canManage ? await ctx.canManage(actor) : false;
    if (!allowed) return { error: "Недостаточно прав для отчёта по чужому чату." };
  }
  const chatId = requested ?? current;
  if (!chatId) return { error: "Укажите chatId (текущий чат не определён)." };

  // R4: «весь период» = без дат → лимит покрывает все записи.
  const result = await repo.query({
    chatId,
    threadId: args.threadId,
    fromDate: args.fromDate,
    toDate: args.toDate,
    limit: 10_000,
  });

  const rows = result.documents;
  const totalAmount = rows.reduce((acc, d) => acc + (d.total ?? 0), 0);
  const periodLabel =
    !args.fromDate && !args.toDate
      ? "весь период"
      : `${args.fromDate ?? "…"} — ${args.toDate ?? "…"}`;

  const filePath = await renderExpensePdfRussian({
    title: `Расходы · ${chatId}`,
    periodLabel,
    rows: rows.map((d) => ({
      date: d.docDate,
      supplier: d.supplier,
      total: d.total,
      currency: d.currency,
      needsReview: d.needsReview,
    })),
    totalAmount,
    currency: result.currency,
  });

  const dedupeKey = `expense-pdf:${chatId}:${args.fromDate ?? ""}:${args.toDate ?? ""}:${totalAmount.toFixed(2)}:${rows.length}`;
  return {
    filePath,
    caption: `Отчёт по расходам за ${periodLabel}`,
    dedupeKey,
    totalAmount,
    count: rows.length,
  };
}
