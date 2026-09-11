/**
 * PROMPT 08 — авторизация мутаций правил чата.
 *
 * read (list) — доступен; create/update/delete/reset — только:
 *   - creator/administrator ТЕКУЩЕГО чата (server-side getChatMember), ИЛИ
 *   - owner/admin ACL (canManage).
 * При API error — deny (fail closed). DM (private) — правила своего чата.
 */
import type { TelegramRulesHandler } from "./TelegramBridge.js";

export interface RulesAuthDeps {
  /** Исходный handler (runRulesCommand). */
  run: (args: string, ctx: { chatId: string; userId: string }) => string;
  /** server-side статус actor'а (grammy getChatMember). */
  getChatMember?: (chatId: string, userId: string) => Promise<{ status: string }>;
  users: { canManage(userId: string | number): Promise<boolean> };
}

const MUTATING = /^(add|delete|on|off)\b/;

function isGroupAdminStatus(status: string): boolean {
  return status === "creator" || status === "administrator";
}

export function makeGuardedRulesHandler(deps: RulesAuthDeps): TelegramRulesHandler {
  return async (args, ctx) => {
    const sub = args.trim().split(/\s+/)[0] ?? "";
    const isMutation = MUTATING.test(`${sub} `);
    if (!isMutation) return deps.run(args, ctx);

    // DM: пользователь управляет правилами своего чата.
    if (ctx.chatType === "private") return deps.run(args, ctx);

    // Группа/канал: только creator/administrator (server-side) или canManage.
    if (!deps.getChatMember) return "Нет возможности проверить права.";
    try {
      const { status } = await deps.getChatMember(ctx.chatId, ctx.userId);
      if (isGroupAdminStatus(status)) return deps.run(args, ctx);
      if (await deps.users.canManage(ctx.userId)) return deps.run(args, ctx);
      return "Нужны права администратора группы.";
    } catch {
      // Fail closed: при ошибке API — deny, без catch { return true }.
      return "Не удалось проверить права, попробуйте позже.";
    }
  };
}
