/**
 * Users ACL — типы для runtime-управления пользователями без рестарта.
 *
 * Users ACL = *кому* можно писать боту (в отличие от User Rules = *как* бот
 * себя ведёт). Источник правды — disk store `~/.grish-ai/users.json` +
 * in-memory cache с invalidate при записи.
 */

export type UserRole = "owner" | "admin" | "user" | "blocked";

/** Режим для пользователей, которых НЕТ в store. */
export type AclMode = "open" | "closed";

export interface BotUser {
  /** Telegram user id — всегда строка (overflow/precision-safe). */
  id: string;
  username?: string;
  displayName?: string;
  role: UserRole;
  /** Ограничение на конкретные chat id (string). Пусто/undefined = все чаты. */
  chats?: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  createdBy?: string; // actor user id
  note?: string;
}

export interface UsersStoreFile {
  version: 1;
  users: BotUser[];
}

export interface UsersAddInput {
  id: string | number;
  username?: string;
  displayName?: string;
  /** По умолчанию "user"; owner через add НЕ назначается (только config bootstrap). */
  role?: UserRole;
  chats?: string[];
  note?: string;
  actorId?: string;
}

/** Нормализация Telegram user id: всегда строка, без пробелов. */
export function normalizeUserId(id: string | number): string {
  return String(id).trim();
}
