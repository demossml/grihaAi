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
import { buildExpenseReportAttachment } from "../../../src/services/documents/expenseReportTools.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { setSessionFile } from "../../../src/utils/telegram/session-files.js";
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

  // R3/R5: PDF-отчёт по расходам ТОЛЬКО из БД (не из LLM-схемы).
  // omit dates = весь период (R4). При hard-rule report_attachment_only=true
  // Telegram шлёт только файл (без текста/подписи), dedupeKey гасит дубли.
  pi.registerTool({
    name: "expenses_report_pdf",
    label: "Expense report PDF",
    description:
      "Сгенерировать PDF-отчёт по расходам чата из БД (без дат = весь период). " +
      "Сумма считается по всем записям чата/темы. Для «отчёт за весь период в PDF» используй этот tool, " +
      "не выдумывай данные вручную.",
    parameters: Type.Object({
      chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
      threadId: Type.Optional(Type.String({ description: "Forum topic; omit = whole chat" })),
      fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
      toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
    }),
    async execute(
      _id: string,
      params: {
        chatId?: string;
        threadId?: string;
        fromDate?: string;
        toDate?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ path?: string; error?: string }>> {
      const built = await buildExpenseReportAttachment(
        params,
        {
          chatId: toolContext(ctx).chatId,
          userId: toolContext(ctx).userId,
          canManage: (userId) => getUsersService().canManage(userId),
        },
        getDocumentsRepository(),
      );
      if ("error" in built) {
        return { content: [{ type: "text", text: built.error }], details: { error: built.error } };
      }

      // R3: правило «только файл» группы → без текста/подписи + dedupeKey.
      const tctx = getSessionContext(ctx.sessionManager.getSessionId());
      const hardRules = tctx?.chatId ? getUserRulesService().getHardRules(tctx.chatId) : [];
      const attachmentOnly = hardRules.some(
        (r) => r.key === "report_attachment_only" && (r.value === true || r.value === "true"),
      );

      setSessionFile(
        ctx.sessionManager.getSessionId(),
        built.filePath,
        attachmentOnly ? undefined : built.caption,
        { attachmentOnly, dedupeKey: built.dedupeKey },
      );
      return {
        content: [{ type: "text", text: attachmentOnly ? "" : `Report generated: ${built.filePath}` }],
        details: { path: built.filePath },
      };
    },
  });
}
