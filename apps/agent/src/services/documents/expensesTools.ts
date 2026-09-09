/**
 * expenses_sum / expenses_list — обработчики tool'ов.
 * Жёсткое правило: период применяется ТОЛЬКО если пользователь явно указал
 * fromDate/toDate/period. Никаких дефолтных «14 дней».
 */
import { formatExpensesSum, resolvePeriod } from "./extractors/parsers.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpensesQuery, ExpensesQueryResult } from "./types.js";

export interface ExpensesToolArgs {
  chatId?: string;
  supplier?: string;
  fromDate?: string;
  toDate?: string;
  period?: "7d" | "14d" | "30d" | "month";
}

export interface ExpensesToolContext {
  /** Текущий чат сессии (default scope). */
  chatId?: string;
  /** Actor user id (owner/admin могут запрашивать чужие чаты). */
  userId?: string;
  canManage?: (userId: string) => Promise<boolean>;
}

async function resolveQuery(
  args: ExpensesToolArgs,
  ctx: ExpensesToolContext,
): Promise<ExpensesQuery | { error: string }> {
  let { fromDate, toDate } = args;
  // relative period применяется только если пользователь его явно передал
  if (!fromDate && !toDate && args.period) {
    ({ fromDate, toDate } = resolvePeriod(args.period));
  }

  const currentChat = ctx.chatId;
  const requested = args.chatId;
  if (requested && currentChat && requested !== currentChat) {
    // Чужой chatId — только owner/admin.
    const actor = ctx.userId ?? "";
    const allowed = ctx.canManage ? await ctx.canManage(actor) : false;
    if (!allowed) {
      return { error: "Недостаточно прав для запроса чужого чата." };
    }
  }

  return {
    chatId: requested ?? currentChat,
    supplier: args.supplier,
    fromDate,
    toDate,
  };
}

export async function expensesSumHandler(
  args: ExpensesToolArgs,
  ctx: ExpensesToolContext,
  repo: DocumentsRepository,
): Promise<string> {
  const q = await resolveQuery(args, ctx);
  if ("error" in q) return q.error;
  const result = await repo.query(q);
  return formatExpensesSum(result);
}

export async function expensesListHandler(
  args: ExpensesToolArgs,
  ctx: ExpensesToolContext,
  repo: DocumentsRepository,
): Promise<string> {
  const q = await resolveQuery(args, ctx);
  if ("error" in q) return q.error;
  const result: ExpensesQueryResult = await repo.query({ ...q, limit: 50 });
  if (result.count === 0) return "Записей по заданным фильтрам нет.";
  const scope = result.fullHistory ? "вся история чата" : "выбранный период";
  const lines = result.documents.map(
    (d) =>
      `- ${d.docDate} | ${d.supplier ?? "?"} | ${d.total ?? "?"} ${d.currency}${d.needsReview ? " (проверка)" : ""}${d.fileName ? ` | ${d.fileName}` : ""}`,
  );
  return [
    `Охват: ${scope}`,
    `Документов: ${result.count}`,
    result.note ? `Note: ${result.note}` : "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}
