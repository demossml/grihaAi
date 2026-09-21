/**
 * documents — расходы по чекам/накладным: tools expenses_sum / expenses_list.
 *
 * Жёсткие правила (см. SKILL expenses):
 * - цифры ТОЛЬКО из store/tool;
 * - default период = вся история чата, period передавать только по явному запросу;
 * - пустой результат → «Записей ... нет».
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getUsersService } from "../../../src/services/UsersService.js";
import { getDocumentsRepository } from "../../../src/services/documents/index.js";
import { expensesListHandler, expensesSumHandler, type ExpensesToolArgs } from "../../../src/services/documents/expensesTools.js";
import { buildExpenseReport, type ExpenseReportInputDoc } from "../../../src/services/documents/expenseReport.js";
import { getSessionContext } from "../user-rules/context.js";
import { createReportDataService, type ReportDataService } from "@griha/report-data";
import { createDocumentsExpensesReader } from "../../../src/services/documents/reportDataAdapter.js";
import { getChatSetupService } from "../chat-setup/ChatSetupService.js";
import type { DocumentsRepository } from "../../../src/services/documents/DocumentsRepository.js";
import { resolveReportDataScope, type ReportChatType } from "../../../src/services/documents/reportDataScope.js";
import { resolveGroupQuery, type GroupTitleRecord } from "../../../src/services/documents/resolveGroupQuery.js";
import { assertCanReadChat, type GroupAccessDeps } from "../../../src/services/documents/groupHistoryTools.js";

const PERIOD = Type.Optional(Type.Union([Type.Literal("7d"), Type.Literal("14d"), Type.Literal("30d"), Type.Literal("month")]));

const ExpensesSchema = Type.Object({
  chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
  scope: Type.Optional(
    Type.Union([Type.Literal("thread"), Type.Literal("chat")], {
      description:
        "thread = current topic only (default when message is in a forum topic). chat = entire group across all topics. Use chat only if user asks for whole group.",
    }),
  ),
  threadId: Type.Optional(Type.String({ description: "Optional override; normally from context" })),
  supplier: Type.Optional(Type.String({ description: "Optional supplier substring" })),
  fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
  toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
  period: PERIOD,
});

function toolContext(ctx: ExtensionContext): {
  chatId?: string;
  threadId?: string;
  userId?: string;
  canManage: (userId: string) => Promise<boolean>;
} {
  const tctx = getSessionContext(ctx.sessionManager.getSessionId());
  return {
    chatId: tctx?.chatId,
    threadId: tctx?.threadId,
    userId: tctx?.userId,
    canManage: (userId) => getUsersService().canManage(userId),
  };
}

function getReportDataService(repo: DocumentsRepository): ReportDataService {
  return createReportDataService({
    reader: createDocumentsExpensesReader(repo),
    getGroupTitle: (chatId) => {
      try {
        return getChatSetupService().getChatTitleSync(chatId);
      } catch {
        return undefined;
      }
    },
  });
}

/** Эвристика: Telegram group/supergroup имеют отрицательный chatId. */
function isGroupLikeChatId(chatId?: string): boolean {
  if (!chatId) return false;
  const n = Number(chatId);
  return Number.isFinite(n) && n < 0;
}

function reportAclDeps(): GroupAccessDeps {
  const setup = getChatSetupService();
  const users = getUsersService();
  return {
    isConfiguredSync: (chatId) => setup.isConfiguredSync(chatId),
    canManage: (userId) => users.canManage(userId),
    isAllowed: (userId, chatId) => users.isAllowed(userId, chatId),
    listConfiguredChatIds: async () =>
      (await setup.list()).filter((c) => c.status === "active").map((c) => c.chatId),
  };
}

type ResolveChatOutcome =
  | { ok: true; chatId: string; threadId?: string }
  | {
      ok: false;
      code: string;
      message: string;
      candidates?: Array<{ chatId: string; title: string | null }>;
    };

/**
 * Финальный chatId для report_data_*: группа → свой ctx; личка → args.chatId
 * или groupQuery (название → chatId) + ACL. aclDeps/listSetupRecords injectable.
 */
async function resolveReportDataChat(
  ctx: ExtensionContext,
  args: { chatId?: string; groupQuery?: string; threadId?: string },
  aclDeps: GroupAccessDeps,
  listSetupRecords: () => Promise<Array<{ chatId: string; chatTitle: string | null }>>,
): Promise<ResolveChatOutcome> {
  const tctx = getSessionContext(ctx.sessionManager.getSessionId());
  const ctxChatId = tctx?.chatId;
  const isGroupLike = isGroupLikeChatId(ctxChatId);
  const ctxChatType: ReportChatType = isGroupLike ? "group" : "private";

  if (isGroupLike) {
    const scope = resolveReportDataScope({
      ctxChatId,
      ctxChatType,
      ctxThreadId: tctx?.threadId,
      ctxUserId: tctx?.userId,
      argsChatId: args.chatId,
      argsThreadId: args.threadId,
    });
    if (!scope.ok) return { ok: false, code: scope.code, message: scope.message };
    return { ok: true, chatId: scope.chatId, threadId: scope.threadId };
  }

  // private
  const userId = tctx?.userId;
  if (!userId) {
    return { ok: false, code: "DENY", message: "Не определён пользователь сессии." };
  }

  let chatId: string | undefined;
  if (args.chatId?.trim()) {
    chatId = args.chatId.trim();
    const allowed = await assertCanReadChat(userId, chatId, aclDeps);
    if (!allowed) return { ok: false, code: "DENY", message: "Чат не настроен или нет доступа." };
  } else if (args.groupQuery?.trim()) {
    const active = await listSetupRecords();
    const records: GroupTitleRecord[] = [];
    for (const c of active) {
      if (await assertCanReadChat(userId, c.chatId, aclDeps)) {
        records.push({ chatId: c.chatId, chatTitle: c.chatTitle ?? null });
      }
    }
    const resolved = resolveGroupQuery(args.groupQuery, records);
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        message: resolved.message,
        candidates: resolved.candidates,
      };
    }
    chatId = resolved.chatId;
  } else {
    return {
      ok: false,
      code: "MISSING_CHAT_ID",
      message: "Укажите chatId группы или groupQuery (название из /groups).",
    };
  }

  return { ok: true, chatId, threadId: args.threadId || undefined };
}

function denyJson(outcome: {
  code: string;
  message: string;
  candidates?: Array<{ chatId: string; title: string | null }>;
}): string {
  return JSON.stringify({
    ok: false,
    code: outcome.code,
    message: outcome.message,
    ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
  });
}

export default function documents(
  pi: ExtensionAPI,
  deps?: {
    documentsRepo?: DocumentsRepository;
    aclDeps?: GroupAccessDeps;
    listSetupRecords?: () => Promise<Array<{ chatId: string; chatTitle: string | null }>>;
  },
): void {
  const aclDeps = deps?.aclDeps ?? reportAclDeps();
  const listSetupRecords =
    deps?.listSetupRecords ??
    (async () => {
      const setup = getChatSetupService();
      return (await setup.list())
        .filter((c) => c.status === "active")
        .map((c) => ({ chatId: c.chatId, chatTitle: c.chatTitle ?? null }));
    });
  pi.registerTool({
    name: "expenses_sum",
    label: "Sum expenses",
    description:
      "Sum stored expense documents. Default scope: if the user message is in a forum topic, " +
      "aggregate THAT topic's full history (unless user asks for the whole group); if not in a topic, " +
      "aggregate the whole chat. Date filters only when user explicitly asks for a period. Never invent numbers.",
    parameters: ExpensesSchema,
    async execute(
      _id: string,
      params: ExpensesToolArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await expensesSumHandler(params, toolContext(ctx), getDocumentsRepository());
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "expenses_list",
    label: "List expenses",
    description:
      "List stored expense documents. Default scope: if the user message is in a forum topic, " +
      "list THAT topic's full history (unless user asks for the whole group); if not in a topic, " +
      "list the whole chat. Date filters only when user explicitly asks for a period. Never invent numbers.",
    parameters: ExpensesSchema,
    async execute(
      _id: string,
      params: ExpensesToolArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await expensesListHandler(params, toolContext(ctx), getDocumentsRepository());
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  const ReportSchema = Type.Object({
    chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
    scope: Type.Optional(
      Type.Union([Type.Literal("thread"), Type.Literal("chat")], {
        description: "thread = current topic only (default when in a forum topic). chat = entire group.",
      }),
    ),
    threadId: Type.Optional(Type.String()),
    fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
    toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
    period: PERIOD,
  });

  pi.registerTool({
    name: "generate_expense_report",
    label: "Generate expense report (эталонный формат)",
    description:
      "Generate the expense report strictly in the эталон format for группа «ремонт» " +
      "(заголовок → ЗАКУПКА МАТЕРИАЛА с позициями → УСЛУГИ → ИТОГО ЗА ПЕРИОД). " +
      "Sums only from stored documents; never invent numbers. Date filters only when " +
      "the user explicitly asks for a period.",
    parameters: ReportSchema,
    async execute(
      _id: string,
      params: ExpensesToolArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const tctx = toolContext(ctx);
      const repo = getDocumentsRepository();
      const q = await repo.query({
        chatId: params.chatId ?? tctx.chatId,
        threadId: params.threadId ?? tctx.threadId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        limit: 200,
      });

      const docs: ExpenseReportInputDoc[] = (q.documents ?? []).map((d) => ({
        docDate: d.docDate,
        supplier: d.supplier,
        total: d.total,
        currency: d.currency,
        items: d.items,
        needsReview: d.needsReview,
      }));

      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: "Записей по заданным фильтрам нет." }],
          details: { result: "Записей по заданным фильтрам нет." },
        };
      }

      const periodLabel = params.fromDate || params.toDate
        ? `${params.fromDate ?? "…"} — ${params.toDate ?? "…"}`
        : "весь период";
      const report = buildExpenseReport(docs, { periodLabel });
      return { content: [{ type: "text", text: report }], details: { result: report } };
    },
  });

  const ReportDataExpensesSchema = Type.Object({
    chatId: Type.Optional(
      Type.String({ description: "Telegram chat id группы. В личке можно передать groupQuery вместо chatId." }),
    ),
    groupQuery: Type.Optional(
      Type.String({ description: "Название группы (из /groups), если chatId неизвестен. Только личка." }),
    ),
    format: Type.Union([Type.Literal("compact"), Type.Literal("expanded")], {
      description: "compact = сводка+поставщики; expanded = + позиции чеков",
    }),
    fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit = вся история" })),
    toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit = вся история" })),
    threadId: Type.Optional(Type.String()),
  });

  const ReportDataProblemsSchema = Type.Object({
    chatId: Type.Optional(
      Type.String({ description: "Telegram chat id группы. В личке можно передать groupQuery вместо chatId." }),
    ),
    groupQuery: Type.Optional(
      Type.String({ description: "Название группы (из /groups), если chatId неизвестен. Только личка." }),
    ),
    fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD" })),
    toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD" })),
    threadId: Type.Optional(Type.String()),
  });

  pi.registerTool({
    name: "report_data_expenses",
    label: "Report data: expenses",
    description:
      "Собрать расходы группы из БД (без повторного OCR). " +
      "В группе — всегда текущая группа; в личке укажи chatId группы или groupQuery (название из /groups, напр. 'Ремонт'). " +
      "format: compact | expanded. Без fromDate/toDate — вся история. Не используй group_history для сумм чеков.",
    parameters: ReportDataExpensesSchema,
    async execute(
      _id: string,
      params: {
        chatId?: string;
        groupQuery?: string;
        format: "compact" | "expanded";
        fromDate?: string;
        toDate?: string;
        threadId?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const resolved = await resolveReportDataChat(ctx, params, aclDeps, listSetupRecords);
      if (!resolved.ok) {
        const text = denyJson(resolved);
        return { content: [{ type: "text", text }], details: { result: text } };
      }
      const result = await getReportDataService(
        deps?.documentsRepo ?? getDocumentsRepository(),
      ).buildExpenseReport({
        chatId: resolved.chatId,
        format: params.format,
        period: { fromDate: params.fromDate, toDate: params.toDate },
        threadId: resolved.threadId,
      });
      const text = JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "report_data_problems",
    label: "Report data: problems",
    description:
      "Список проблемных чеков группы (нет суммы, needs_review, пустой OCR) для ручного дополнения. " +
      "В группе — текущая группа; в личке — chatId или groupQuery (название из /groups).",
    parameters: ReportDataProblemsSchema,
    async execute(
      _id: string,
      params: {
        chatId?: string;
        groupQuery?: string;
        fromDate?: string;
        toDate?: string;
        threadId?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const resolved = await resolveReportDataChat(ctx, params, aclDeps, listSetupRecords);
      if (!resolved.ok) {
        const text = denyJson(resolved);
        return { content: [{ type: "text", text }], details: { result: text } };
      }
      const result = await getReportDataService(
        deps?.documentsRepo ?? getDocumentsRepository(),
      ).listProblemExpenses({
        chatId: resolved.chatId,
        period: { fromDate: params.fromDate, toDate: params.toDate },
        threadId: resolved.threadId,
      });
      const text = JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });
}
