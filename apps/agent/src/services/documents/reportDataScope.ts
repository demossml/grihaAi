/**
 * scope report_data: группа vs личка. Чистая функция (без БД/сети).
 * Группа → только свой ctx.chatId; личка → только args.chatId.
 */

export type ReportChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

export interface ReportDataScopeInput {
  ctxChatId?: string;
  ctxChatType?: ReportChatType;
  ctxThreadId?: string;
  ctxUserId?: string;
  argsChatId?: string;
  argsThreadId?: string;
}

export type ReportDataScopeResult =
  | {
      ok: true;
      chatId: string;
      threadId?: string;
      source: "ctx_group" | "args_private";
    }
  | {
      ok: false;
      code: "MISSING_CHAT_ID" | "CHAT_MISMATCH" | "DENY";
      message: string;
    };

export function resolveReportDataScope(input: ReportDataScopeInput): ReportDataScopeResult {
  const ctxId = input.ctxChatId?.trim() || "";
  const argId = input.argsChatId?.trim() || "";
  const chatType = input.ctxChatType ?? "unknown";

  const isGroupLike =
    chatType === "group" || chatType === "supergroup" || chatType === "channel";

  if (isGroupLike) {
    if (!ctxId) {
      return { ok: false, code: "MISSING_CHAT_ID", message: "Нет chatId группы в контексте." };
    }
    if (argId && argId !== ctxId) {
      return {
        ok: false,
        code: "CHAT_MISMATCH",
        message: "В группе нельзя запрашивать данные другой группы.",
      };
    }
    const threadId =
      input.argsThreadId !== undefined && input.argsThreadId !== ""
        ? input.argsThreadId
        : input.ctxThreadId;
    return { ok: true, chatId: ctxId, threadId: threadId || undefined, source: "ctx_group" };
  }

  // private или unknown без group context → требуем args
  if (!argId) {
    return {
      ok: false,
      code: "MISSING_CHAT_ID",
      message: "Укажите chatId группы (из /groups). В личке отчёт без chatId группы недоступен.",
    };
  }
  return {
    ok: true,
    chatId: argId,
    threadId: input.argsThreadId || undefined,
    source: "args_private",
  };
}
