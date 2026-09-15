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

export default function documents(pi: ExtensionAPI): void {
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
}
