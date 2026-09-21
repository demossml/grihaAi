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

export default function documents(
  pi: ExtensionAPI,
  deps?: { documentsRepo?: DocumentsRepository },
): void {
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
    chatId: Type.String({ description: "Telegram chat id группы (не лички). Обязателен." }),
    format: Type.Union([Type.Literal("compact"), Type.Literal("expanded")], {
      description: "compact = сводка+поставщики; expanded = + позиции чеков",
    }),
    fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit = вся история" })),
    toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit = вся история" })),
    threadId: Type.Optional(Type.String()),
  });

  const ReportDataProblemsSchema = Type.Object({
    chatId: Type.String({ description: "Telegram chat id группы." }),
    fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD" })),
    toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD" })),
    threadId: Type.Optional(Type.String()),
  });

  pi.registerTool({
    name: "report_data_expenses",
    label: "Report data: expenses",
    description:
      "Собрать расходы группы из БД (без повторного OCR). " +
      "Обязателен chatId группы (не лички). format: compact | expanded. " +
      "Без fromDate/toDate — вся история. Не используй group_history для сумм чеков.",
    parameters: ReportDataExpensesSchema,
    async execute(
      _id: string,
      params: {
        chatId: string;
        format: "compact" | "expanded";
        fromDate?: string;
        toDate?: string;
        threadId?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const result = await getReportDataService(
        deps?.documentsRepo ?? getDocumentsRepository(),
      ).buildExpenseReport({
        chatId: params.chatId,
        format: params.format,
        period: { fromDate: params.fromDate, toDate: params.toDate },
        threadId: params.threadId,
      });
      const text = JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "report_data_problems",
    label: "Report data: problems",
    description:
      "Список проблемных чеков группы (нет суммы, needs_review, пустой OCR) для ручного дополнения.",
    parameters: ReportDataProblemsSchema,
    async execute(
      _id: string,
      params: { chatId: string; fromDate?: string; toDate?: string; threadId?: string },
      _signal: unknown,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const result = await getReportDataService(
        deps?.documentsRepo ?? getDocumentsRepository(),
      ).listProblemExpenses({
        chatId: params.chatId,
        period: { fromDate: params.fromDate, toDate: params.toDate },
        threadId: params.threadId,
      });
      const text = JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });
}
