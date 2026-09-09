/**
 * Пакет B — авторизация настройки групп через getChatMember.
 * Только реальный creator/administrator ТЕКУЩЕЙ группы может применять пресеты.
 */
import { parseTelegramError } from "./telegram-errors.js";

export type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked"
  | "unknown";

export function isGroupAdminStatus(status: ChatMemberStatus): boolean {
  return status === "creator" || status === "administrator";
}

/** Нормализовать raw-статус из Telegram API в ChatMemberStatus. */
export function mapChatMemberStatus(raw: string | undefined | null): ChatMemberStatus {
  switch (raw) {
    case "creator":
    case "administrator":
    case "member":
    case "restricted":
    case "left":
    case "kicked":
      return raw;
    default:
      return "unknown";
  }
}

export async function assertCanConfigureGroup(input: {
  chatId: string;
  userId: string;
  getChatMember: (chatId: string, userId: string) => Promise<ChatMemberStatus>;
  users: { canManage(userId: string | number): Promise<boolean> };
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let status: ChatMemberStatus;
  try {
    status = await input.getChatMember(input.chatId, input.userId);
  } catch (err: unknown) {
    // Fail closed. Сетевые сбои — «попробуйте позже», 400/403 — «нет прав».
    const parsed = parseTelegramError(err);
    if (parsed.kind === "forbidden" || parsed.kind === "bad_request") {
      return { ok: false, reason: "Нужны права администратора группы." };
    }
    return { ok: false, reason: "Не удалось проверить права, попробуйте позже." };
  }

  // FR-4: creator/administrator этой группы ИЛИ пользователь с ролью
  // owner/admin в ACL бота (canManage) может настраивать группу.
  if (isGroupAdminStatus(status)) return { ok: true };
  try {
    if (await input.users.canManage(input.userId)) return { ok: true };
  } catch {
    /* canManage упал → трактуем как false */
  }
  return { ok: false, reason: "Нужны права администратора группы." };
}
