/**
 * expenses_sum / expenses_list — обработчики tool'ов.
 * Жёсткое правило: период применяется ТОЛЬКО если пользователь явно указал
 * fromDate/toDate/period. Никаких дефолтных «14 дней».
 */
import { formatExpensesSum, resolvePeriod } from "./extractors/parsers.js";
import { normalizeThreadId } from "../../../.pi/extensions/telegram-bot/threads.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpensesQuery, ExpensesQueryResult } from "./types.js";

export interface ExpensesToolArgs {
  chatId?: string;
  /** scope: thread = текущая тема (default в теме), chat = вся группа. */
  scope?: "thread" | "chat";
  /** Явный override темы (обычно из контекста). */
  threadId?: string;
  supplier?: string;
  fromDate?: string;
  toDate?: string;
  period?: "7d" | "14d" | "30d" | "month";
}

export interface ExpensesToolContext {
  /** Текущий чат сессии (default scope). */
  chatId?: string;
  /** Текущая тема форума сессии. */
  threadId?: string;
  /** Actor user id (owner/admin могут запрашивать чужие чаты). */
  userId?: string;
  canManage?: (userId: string) => Promise<boolean>;
}

/**
 * Резолв scope темы (§8): явный scope/threadId побеждает; иначе — текущая тема;
 * темы нет → весь чат.
 */
export function resolveExpensesScope(input: {
  ctxThreadId?: string;
  scopeArg?: "thread" | "chat";
  threadIdArg?: string;
}): { threadId?: string } {
  if (input.threadIdArg !== undefined) {
    const explicit = normalizeThreadId(input.threadIdArg);
    return { threadId: explicit }; // пустая строка = весь чат
  }
  if (input.scopeArg === "chat") return { threadId: undefined };
  if (input.scopeArg === "thread") return { threadId: input.ctxThreadId };
  // default
  if (input.ctxThreadId) return { threadId: input.ctxThreadId };
  return { threadId: undefined };
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

  const { threadId } = resolveExpensesScope({
    ctxThreadId: ctx.threadId,
    scopeArg: args.scope,
    threadIdArg: args.threadId,
  });

  return {
    chatId: requested ?? currentChat,
    threadId,
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
  // R4: «весь период» (без дат) = все записи; период — обычный лимит.
  const isFullHistory = !args.fromDate && !args.toDate && !args.period;
  const limit = isFullHistory ? 10_000 : 50;
  const result: ExpensesQueryResult = await repo.query({ ...q, limit });
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
