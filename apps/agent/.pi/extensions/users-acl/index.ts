/**
 * users-acl — инструменты управления пользователями из агентского цикла
 * (натуральный язык: «добавь пользователя 123», «заблокируй 456» и т.д.).
 *
 * Все mutations — только owner/admin (canManage). Изменения применяются
 * НЕМЕДЛЕННО (disk store + cache), следующий входящий апдейт уже видит их —
 * рестарт не нужен. Owner через tools НЕ назначается (только config bootstrap).
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getUsersService } from "../../../src/services/UsersService.js";
import { getSessionContext } from "../user-rules/context.js";

function resolveActorId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

const DENIED = "Недостаточно прав. Нужна роль owner или admin.";

export default function usersAcl(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "users_list",
    label: "List bot users",
    description: "Список пользователей бота (ACL). Только owner/admin.",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ users: unknown[] }>> {
      const service = getUsersService();
      if (!(await service.canManage(resolveActorId(ctx)))) {
        return { content: [{ type: "text", text: DENIED }], details: { users: [] } };
      }
      const users = await service.list();
      const text =
        users.length === 0
          ? "Users (0)"
          : `Users (${users.length}):\n` +
            users
              .map(
                (u) =>
                  `- ${u.id}${u.username ? ` @${u.username}` : ""} [${u.role}]` +
                  `${u.createdAt ? ` created=${u.createdAt.slice(0, 10)}` : ""}`,
              )
              .join("\n");
      return { content: [{ type: "text", text }], details: { users } };
    },
  });

  pi.registerTool({
    name: "users_add",
    label: "Add user",
    description:
      "Добавить/обновить пользователя в ACL (Telegram user id). Только owner/admin. Применяется немедленно, без рестарта.",
    parameters: Type.Object({
      userId: Type.String({ description: "Telegram user id (numeric, строкой)" }),
      username: Type.Optional(Type.String()),
      displayName: Type.Optional(Type.String()),
      role: Type.Optional(Type.Union([Type.Literal("admin"), Type.Literal("user"), Type.Literal("blocked")])),
      note: Type.Optional(Type.String()),
    }),
    async execute(
      _toolCallId: string,
      params: {
        userId: string;
        username?: string;
        displayName?: string;
        role?: "admin" | "user" | "blocked";
        note?: string;
      },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const actorId = resolveActorId(ctx);
      const service = getUsersService();
      if (!(await service.canManage(actorId))) {
        return { content: [{ type: "text", text: DENIED }], details: { id: "" } };
      }
      try {
        const user = await service.add({
          id: params.userId,
          username: params.username,
          displayName: params.displayName,
          role: params.role,
          note: params.note,
          actorId,
        });
        return {
          content: [{ type: "text", text: `OK: user ${user.id} role=${user.role}` }],
          details: { id: user.id },
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: err instanceof Error ? err.message : String(err) },
          ],
          details: { id: "" },
        };
      }
    },
  });

  pi.registerTool({
    name: "users_set_role",
    label: "Set user role",
    description: "Сменить роль пользователя (admin|user|blocked). Только owner/admin. Применяется немедленно.",
    parameters: Type.Object({
      userId: Type.String({ description: "Telegram user id" }),
      role: Type.Union([Type.Literal("admin"), Type.Literal("user"), Type.Literal("blocked")]),
    }),
    async execute(
      _toolCallId: string,
      params: { userId: string; role: "admin" | "user" | "blocked" },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const actorId = resolveActorId(ctx);
      const service = getUsersService();
      if (!(await service.canManage(actorId))) {
        return { content: [{ type: "text", text: DENIED }], details: { id: "" } };
      }
      try {
        const user = await service.setRole(params.userId, params.role, actorId);
        return {
          content: [{ type: "text", text: `OK: user ${user.id} role=${user.role}` }],
          details: { id: user.id },
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: err instanceof Error ? err.message : String(err) },
          ],
          details: { id: "" },
        };
      }
    },
  });

  pi.registerTool({
    name: "users_remove",
    label: "Remove user",
    description: "Удалить пользователя из ACL. Только owner/admin. Применяется немедленно.",
    parameters: Type.Object({
      userId: Type.String({ description: "Telegram user id" }),
    }),
    async execute(
      _toolCallId: string,
      params: { userId: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ removed: boolean }>> {
      const service = getUsersService();
      if (!(await service.canManage(resolveActorId(ctx)))) {
        return { content: [{ type: "text", text: DENIED }], details: { removed: false } };
      }
      try {
        const removed = await service.remove(params.userId);
        return {
          content: [
            {
              type: "text",
              text: removed ? `OK: user ${String(params.userId).trim()} removed` : `User ${String(params.userId).trim()} not found.`,
            },
          ],
          details: { removed },
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: err instanceof Error ? err.message : String(err) },
          ],
          details: { removed: false },
        };
      }
    },
  });
}
