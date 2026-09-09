/**
 * Chat-команда /users ... — дешёвый path без LLM (как /rules).
 *
 *   /users                    → list
 *   /users add <id> [role]    → add/update (role: admin|user|blocked)
 *   /users role <id> <role>   → set role
 *   /users remove <id>        → remove
 *
 * Guard: только owner/admin (canManage).
 */
import type { UserRole } from "../types/users.js";
import { normalizeUserId } from "../types/users.js";
import type { UsersService } from "./UsersService.js";

const MANAGE_ROLES: UserRole[] = ["admin", "user", "blocked"];

function parseRole(raw: string | undefined): UserRole | undefined {
  if (!raw) return undefined;
  return MANAGE_ROLES.find((r) => r === raw);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function handleUsersCommand(
  service: UsersService,
  args: string,
  ctx: { userId: string },
): Promise<string> {
  if (!(await service.canManage(ctx.userId))) {
    return "Недостаточно прав. Нужна роль owner или admin.";
  }

  const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  const cmd = sub ?? "list";

  switch (cmd) {
    case "list": {
      const users = await service.list();
      if (users.length === 0) return "Users (0)";
      const lines = users.map(
        (u) =>
          `- ${u.id}${u.username ? ` @${u.username}` : ""} [${u.role}]` +
          `${u.createdAt ? ` created=${u.createdAt.slice(0, 10)}` : ""}`,
      );
      return `Users (${users.length}):\n${lines.join("\n")}`;
    }

    case "add": {
      const [rawId, rawRole] = rest;
      const id = normalizeUserId(rawId ?? "");
      if (!id) return "Укажи numeric user id: /users add <id> [role]";
      const role = parseRole(rawRole);
      if (rawRole !== undefined && !role) {
        return `Неизвестная роль "${rawRole}" (допустимо: admin|user|blocked).`;
      }
      try {
        const user = await service.add({ id, role, actorId: ctx.userId });
        return `OK: user ${user.id} role=${user.role}`;
      } catch (err) {
        return errorText(err);
      }
    }

    case "role": {
      const [rawId, rawRole] = rest;
      const id = normalizeUserId(rawId ?? "");
      const role = parseRole(rawRole);
      if (!id) return "Укажи numeric user id: /users role <id> <role>";
      if (!role) return `Неизвестная роль "${rawRole ?? ""}" (допустимо: admin|user|blocked).`;
      try {
        const user = await service.setRole(id, role, ctx.userId);
        return `OK: user ${user.id} role=${user.role}`;
      } catch (err) {
        return errorText(err);
      }
    }

    case "remove": {
      const [rawId] = rest;
      const id = normalizeUserId(rawId ?? "");
      if (!id) return "Укажи numeric user id: /users remove <id>";
      try {
        const removed = await service.remove(id);
        return removed ? `OK: user ${id} removed` : `User ${id} not found.`;
      } catch (err) {
        return errorText(err);
      }
    }

    default:
      return "Использование: /users [list | add <id> [role] | role <id> <role> | remove <id>]";
  }
}
