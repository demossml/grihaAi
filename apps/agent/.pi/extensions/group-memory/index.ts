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
  type GroupAccessDeps,
  type GroupHistoryArgs,
  type GroupRecentArgs,
  type GroupToolsContext,
} from "../../../src/services/documents/groupHistoryTools.js";

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

function realDeps(): GroupAccessDeps {
  const setup = getChatSetupService();
  const users = getUsersService();
  return {
    isConfiguredSync: (chatId) => setup.isConfiguredSync(chatId),
    canManage: (userId) => users.canManage(userId),
    isAllowed: (userId, chatId) => users.isAllowed(userId, chatId),
    listConfiguredChatIds: async () =>
      (await setup.list())
        .filter((c) => c.status === "completed" || c.status === "skipped")
        .map((c) => c.chatId),
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
}
