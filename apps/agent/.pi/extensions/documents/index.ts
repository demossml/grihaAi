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
import {
  buildExpenseReportAttachment,
  expenseUpdateHandler,
  expensesSearchHandler,
  markReportSent,
  wasReportRecentlySent,
} from "../../../src/services/documents/expenseReportTools.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { getChatSetupService } from "../chat-setup/ChatSetupService.js";
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
      "dimension — разрез: none | supplier | category | tag. Суммы и секции — только из БД, " +
      "не выдумывай данные. Для «отчёт за весь период в PDF / по категориям / по поставщикам» используй этот tool.",
    parameters: Type.Object({
      chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
      threadId: Type.Optional(Type.String({ description: "Forum topic; omit = whole chat" })),
      fromDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
      toDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD; omit for full history" })),
      dimension: Type.Optional(
        Type.String({ description: "Разрез отчёта: none | supplier | category | tag (свободная строка)" }),
      ),
      filterValue: Type.Optional(Type.String({ description: "Оставить только одно значение разреза" })),
    }),
    async execute(
      _id: string,
      params: {
        chatId?: string;
        threadId?: string;
        fromDate?: string;
        toDate?: string;
        dimension?: string;
        filterValue?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ path?: string; error?: string }>> {
      const tctx = getSessionContext(ctx.sessionManager.getSessionId());
      const setupRec = tctx?.chatId ? await getChatSetupService().get(tctx.chatId) : null;
      const built = await buildExpenseReportAttachment(
        params,
        {
          chatId: tctx?.chatId,
          userId: tctx?.userId,
          chatTitle: setupRec?.chatTitle,
          canManage: (userId) => getUsersService().canManage(userId),
        },
        getDocumentsRepository(),
      );
      if ("error" in built) {
        return { content: [{ type: "text", text: built.error }], details: { error: built.error } };
      }

      // §6: тот же запрос отчёта в окне 10 минут → не шлём второй PDF.
      if (wasReportRecentlySent(built.dedupeKey)) {
        return {
          content: [{ type: "text", text: "Отчёт только что отправлял." }],
          details: { path: built.filePath },
        };
      }
      markReportSent(built.dedupeKey);

      // R3: правило «только файл» группы → без текста/подписи + dedupeKey.
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

  // F4: исправление категории пользователем + chat-scoped обучение.
  pi.registerTool({
    name: "expense_update",
    label: "Correct expense",
    description:
      "Исправить категорию/теги расхода после фидбека пользователя («перенеси в…», «не туда»). " +
      "Обновляет запись и запоминает правило для этой группы — в следующий раз похожий чек попадёт верно.",
    parameters: Type.Object({
      expenseId: Type.Optional(Type.String({ description: "id расхода; без него — последний в чате" })),
      chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
      category: Type.Optional(Type.String({ description: "Новая свободная категория" })),
      addTags: Type.Optional(Type.Array(Type.String())),
      note: Type.Optional(Type.String({ description: "Примечание (можно «по слову X»)" })),
    }),
    async execute(
      _id: string,
      params: {
        expenseId?: string;
        chatId?: string;
        category?: string;
        addTags?: string[];
        note?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await expenseUpdateHandler(
        params,
        { chatId: toolContext(ctx).chatId, canManage: (u) => getUsersService().canManage(u) },
        getDocumentsRepository(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  // F6: гибкий вопрос «сколько метров кабеля / какие болты».
  pi.registerTool({
    name: "expenses_search",
    label: "Search expenses",
    description:
      "Поиск по расходам чата: raw_text/поставщик/категория/позиции. Для вопросов вида " +
      "«сколько метров кабеля», «какие болты покупали» — ищи позиции и фрагменты чеков, не выдумывай.",
    parameters: Type.Object({
      chatId: Type.Optional(Type.String({ description: "Default: current chat" })),
      query: Type.String({ minLength: 1 }),
      fromDate: Type.Optional(Type.String()),
      toDate: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: { chatId?: string; query: string; fromDate?: string; toDate?: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await expensesSearchHandler(
        params,
        { chatId: toolContext(ctx).chatId },
        getDocumentsRepository(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });
}
