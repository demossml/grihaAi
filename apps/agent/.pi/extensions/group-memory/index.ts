/**
 * group-memory — чтение истории групп из chat_archive (group_history /
 * group_recent) с жёстким ACL (H1–H6).
 *
 * Tools доступны в Telegram-субсессиях (SUB_SESSION_EXTENSIONS) и в основной
 * сессии. ctx.userId/chatId — из session context (тот же механизм, что у
 * expenses_sum/list). Цифры/история — только из store, ничего не выдумывать.
 */
import { Type } from "typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSessionContext } from "../user-rules/context.js";
import { getChatSetupService } from "../chat-setup/ChatSetupService.js";
import { getUsersService } from "../../../src/services/UsersService.js";
import { getDocumentsRepository } from "../../../src/services/documents/index.js";
import {
  groupHistoryHandler,
  groupRecentHandler,
  groupCompareHandler,
  groupReportHandler,
  assertCanReadChat,
  type GroupAccessDeps,
  type GroupCompareArgs,
  type GroupHistoryArgs,
  type GroupRecentArgs,
  type GroupReportArgs,
  type GroupToolsContext,
} from "../../../src/services/documents/groupHistoryTools.js";
import {
  getGroupReminderService,
  type GroupReminderStatus,
} from "../../../src/services/reminders/GroupReminderService.js";

const HistorySchema = Type.Object({
  chatId: Type.Optional(Type.String({ description: "Telegram chat id (e.g. -100…). Default: current chat from session context if omitted." })),
  threadId: Type.Optional(Type.String({ description: "Forum topic id; omit for whole chat or non-forum." })),
  limit: Type.Optional(Type.Number({ description: "Default 30, max 100" })),
  beforeMessageId: Type.Optional(Type.String({ description: "Pagination: only rows with message_id < this (optional)" })),
  kinds: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("text"),
        Type.Literal("photo"),
        Type.Literal("document"),
        Type.Literal("voice"),
        Type.Literal("video"),
        Type.Literal("other"),
      ]),
      { description: "Filter by content kind; omit = all" },
    ),
  ),
  fromDate: Type.Optional(Type.String({ description: "ISO date YYYY-MM-DD inclusive optional" })),
  toDate: Type.Optional(Type.String({ description: "ISO date YYYY-MM-DD inclusive optional" })),
});

const RecentSchema = Type.Object({
  chatId: Type.Optional(Type.String({ description: "Optional; omit = all accessible configured chats (cap 10 chats)" })),
  sinceHours: Type.Optional(Type.Number({ description: "Default 24, max 168" })),
  limit: Type.Optional(Type.Number({ description: "Default 20, max 50" })),
});

const CompareSchema = Type.Object({
  chatIds: Type.Array(Type.String(), { description: "Список chatId для сравнения (каждый проверяется ACL, fail closed)" }),
  sinceHours: Type.Optional(Type.Number({ description: "Default 24, max 168" })),
  limit: Type.Optional(Type.Number({ description: "Default 50, max 200" })),
});

const ReportSchema = Type.Object({
  sourceChatId: Type.String({ description: "Telegram chat id" }),
  dateFrom: Type.Optional(Type.String({ description: "YYYY-MM-DD inclusive optional" })),
  dateTo: Type.Optional(Type.String({ description: "YYYY-MM-DD inclusive optional" })),
  threadId: Type.Optional(Type.String({ description: "Forum topic id; omit for whole chat" })),
});

const ReminderAddSchema = Type.Object({
  chatId: Type.String({ description: "Telegram chat id" }),
  text: Type.String({ description: "Текст напоминания" }),
  dueAt: Type.String({ description: "ISO datetime due (e.g. 2026-09-20T09:00:00.000Z)" }),
  threadId: Type.Optional(Type.String({ description: "Forum topic id optional" })),
  sourceMessageId: Type.Optional(Type.String({ description: "provenance: id исходного сообщения" })),
  confidence: Type.Optional(Type.Number({ description: "0..1; <0.5 → needs_confirmation" })),
});

const ReminderListSchema = Type.Object({
  chatId: Type.String({ description: "Telegram chat id" }),
  status: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("needs_confirmation"),
      Type.Literal("fired"),
      Type.Literal("cancelled"),
    ]),
  ),
});

const ReminderConfirmSchema = Type.Object({
  id: Type.String({ description: "Reminder id" }),
});

function realDeps(): GroupAccessDeps {
  const setup = getChatSetupService();
  const users = getUsersService();
  return {
    isConfiguredSync: (chatId) => setup.isConfiguredSync(chatId),
    canManage: (userId) => users.canManage(userId),
    isAllowed: (userId, chatId) => users.isAllowed(userId, chatId),
    listConfiguredChatIds: async () =>
      (await setup.list())
        .filter((c) => c.status === "active")
        .map((c) => c.chatId),
    getChatTitle: (chatId) => setup.getChatTitleSync(chatId),
  };
}

function toolContext(ctx: ExtensionContext): GroupToolsContext {
  const tctx = getSessionContext(ctx.sessionManager.getSessionId());
  return { chatId: tctx?.chatId, userId: tctx?.userId };
}

export default function groupMemory(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "group_history",
    label: "Group history",
    description:
      "Read archived messages/media metadata for a Telegram group or private chat from chat_archive. " +
      "Use when the user asks what was said/sent in a group. Requires access rights.",
    parameters: HistorySchema,
    async execute(
      _id: string,
      params: GroupHistoryArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await groupHistoryHandler(
        params,
        toolContext(ctx),
        getDocumentsRepository(),
        realDeps(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "group_recent",
    label: "Recent group events",
    description:
      "Recent archive events across groups the caller can access, or one chatId. Use for «что нового».",
    parameters: RecentSchema,
    async execute(
      _id: string,
      params: GroupRecentArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await groupRecentHandler(
        params,
        toolContext(ctx),
        getDocumentsRepository(),
        realDeps(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "groups_compare",
    label: "Compare groups",
    description:
      "Сравнить недавние события по явному списку чатов (sourceChatId/sourceMessageId). " +
      "Каждый chatId проверяется ACL — отказ любого чата → deny (fail closed). Read-only.",
    parameters: CompareSchema,
    async execute(
      _id: string,
      params: GroupCompareArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await groupCompareHandler(
        params,
        toolContext(ctx),
        getDocumentsRepository(),
        realDeps(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "group_report",
    label: "Group report",
    description:
      "Сводка по чату: количество сообщений/файлов + сумма расходов (если есть). " +
      "Read-only, ACL через assertCanReadChat. Без сырых путей.",
    parameters: ReportSchema,
    async execute(
      _id: string,
      params: GroupReportArgs,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ result: string }>> {
      const text = await groupReportHandler(
        params,
        toolContext(ctx),
        getDocumentsRepository(),
        realDeps(),
      );
      return { content: [{ type: "text", text }], details: { result: text } };
    },
  });

  pi.registerTool({
    name: "group_reminder_add",
    label: "Add group reminder",
    description:
      "Создать напоминание для группы (chatId, text, dueAt ISO). ACL через assertCanReadChat. " +
      "low confidence → needs_confirmation (не рассылается без подтверждения).",
    parameters: ReminderAddSchema,
    async execute(
      _id: string,
      params: {
        chatId: string;
        text: string;
        dueAt: string;
        threadId?: string;
        sourceMessageId?: string;
        confidence?: number;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string; status?: string }>> {
      const userId = toolContext(ctx).userId;
      if (!userId) {
        return { content: [{ type: "text", text: "Не определён пользователь сессии." }], details: { id: "" } };
      }
      if (!(await assertCanReadChat(userId, params.chatId, realDeps()))) {
        return { content: [{ type: "text", text: "Нет доступа к чату." }], details: { id: "" } };
      }
      const r = getGroupReminderService().add({
        chatId: params.chatId,
        text: params.text,
        dueAt: params.dueAt,
        threadId: params.threadId,
        sourceMessageId: params.sourceMessageId,
        confidence: params.confidence,
      });
      return {
        content: [{ type: "text", text: `Reminder ${r.id} (${r.status}).` }],
        details: { id: r.id, status: r.status },
      };
    },
  });

  pi.registerTool({
    name: "group_reminder_list",
    label: "List group reminders",
    description: "Список напоминаний чата (опционально по статусу). ACL через assertCanReadChat.",
    parameters: ReminderListSchema,
    async execute(
      _id: string,
      params: { chatId: string; status?: GroupReminderStatus },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ reminders: Array<{ id: string; text: string; dueAt: string; status: string }> }>> {
      const userId = toolContext(ctx).userId;
      if (!userId) {
        return { content: [{ type: "text", text: "Не определён пользователь сессии." }], details: { reminders: [] } };
      }
      if (!(await assertCanReadChat(userId, params.chatId, realDeps()))) {
        return { content: [{ type: "text", text: "Нет доступа к чату." }], details: { reminders: [] } };
      }
      const list = getGroupReminderService().list(params.chatId, params.status);
      const text = list.length === 0
        ? "Напоминаний нет."
        : list.map((r) => `- [${r.status}] ${r.text} (до ${r.dueAt})`).join("\n");
      return {
        content: [{ type: "text", text }],
        details: {
          reminders: list.map((r) => ({ id: r.id, text: r.text, dueAt: r.dueAt, status: r.status })),
        },
      };
    },
  });

  pi.registerTool({
    name: "group_reminder_confirm",
    label: "Confirm group reminder",
    description: "Подтвердить needs_confirmation → pending. Только canManage (owner/admin).",
    parameters: ReminderConfirmSchema,
    async execute(
      _id: string,
      params: { id: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string; status?: string }>> {
      const userId = toolContext(ctx).userId;
      if (!userId) {
        return { content: [{ type: "text", text: "Не определён пользователь сессии." }], details: { id: "" } };
      }
      if (!(await getUsersService().canManage(userId))) {
        return { content: [{ type: "text", text: "Нет доступа. Нужна роль owner или admin." }], details: { id: "" } };
      }
      const r = getGroupReminderService().confirm(params.id);
      if (!r) {
        return { content: [{ type: "text", text: "Reminder не найден или не в статусе needs_confirmation." }], details: { id: "" } };
      }
      return {
        content: [{ type: "text", text: `Reminder ${r.id} подтверждён (${r.status}).` }],
        details: { id: r.id, status: r.status },
      };
    },
  });
}
