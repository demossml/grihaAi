/**
 * Telegram agent ACL (A1–A4):
 *   - group/supergroup: доступ у ЛЮБОГО участника (membership через getChatMember),
 *     без whitelist;
 *   - private: только явный ACL (isAllowedPrivate) — open-режим НЕ пускает;
 *   - left/kicked/unknown/ошибка getChatMember → deny (fail closed);
 *   - канал/без реального from → deny.
 *
 * Этот модуль касается ТОЛЬКО agent-path. Archive/listen_only медиа идут по
 * policy и сюда не попадают (A6).
 */

/** Статусы Telegram-членства, дающие доступ к агенту в группе. */
export const IN_GROUP_STATUSES = new Set([
  "creator",
  "administrator",
  "member",
  "restricted",
]);

export interface TelegramAccessDeps {
  /** DM: только заведённые пользователи (не open-mode). */
  isAllowedPrivate: (userId: string) => Promise<boolean>;
  /** Членство в чате. Без него group-path deny (A3, fail closed). */
  getChatMember?: (chatId: number, userId: number) => Promise<{ status: string }>;
}

export interface TelegramAccessInput {
  userId: number;
  chatId: number;
  chatType: string;
  /** false для channel_post/sender_chat (нет реального from). */
  hasRealUser: boolean;
}

export type TelegramAccessResult =
  | { allowed: true; reason: "ok" }
  | {
      allowed: false;
      reason:
        | "channel-no-user"
        | "acl-denied"
        | "not-in-group"
        | "get-chat-member-error";
    };

export async function resolveTelegramAccess(
  input: TelegramAccessInput,
  deps: TelegramAccessDeps,
): Promise<TelegramAccessResult> {
  if (!input.hasRealUser) return { allowed: false, reason: "channel-no-user" };

  if (input.chatType === "private") {
    // A2: закрытая личка — только явный список, open-режим игнорируем.
    const allowed = await deps.isAllowedPrivate(String(input.userId));
    return allowed ? { allowed: true, reason: "ok" } : { allowed: false, reason: "acl-denied" };
  }

  // group/supergroup (и channel с реальным from): membership, не whitelist.
  if (!deps.getChatMember) return { allowed: false, reason: "not-in-group" };
  try {
    const member = await deps.getChatMember(input.chatId, input.userId);
    return IN_GROUP_STATUSES.has(member.status)
      ? { allowed: true, reason: "ok" }
      : { allowed: false, reason: "not-in-group" };
  } catch {
    // A3: ошибка getChatMember → deny.
    return { allowed: false, reason: "get-chat-member-error" };
  }
}
