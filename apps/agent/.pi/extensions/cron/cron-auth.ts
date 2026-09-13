/**
 * P02 — авторизация Telegram-target при создании cron.
 * global owner/admin (canManage) ИЛИ creator/administrator ЦЕЛЕВОЙ группы
 * (server-side getChatMember, fail closed). Свой DM — target == chatId сессии.
 * Контекст определяет target, но НЕ авторизацию.
 */
import type { CronMemberStatus } from "./cron-bridge.js";

export interface TargetAuthInput {
  actor: string;
  /** chatId текущей Telegram-сессии (если есть). */
  sessionChatId?: string;
  targetChatId: string;
  canManage: (actor: string) => Promise<boolean>;
  getChatMember?: (chatId: string, userId: string) => Promise<CronMemberStatus>;
}

export type TargetAuthResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function assertTargetAllowed(
  input: TargetAuthInput,
): Promise<TargetAuthResult> {
  try {
    if (await input.canManage(input.actor)) return { ok: true };
  } catch {
    /* canManage упал → false */
  }
  // Свой DM (не группа): target совпадает с chatId текущей сессии.
  if (
    input.sessionChatId &&
    input.sessionChatId === input.targetChatId &&
    !input.targetChatId.startsWith("-")
  ) {
    return { ok: true };
  }
  // Группа: только реальный creator/administrator (fail closed).
  if (!input.getChatMember) return { ok: false, reason: "Нет возможности проверить права." };
  try {
    const status = await input.getChatMember(input.targetChatId, input.actor);
    if (status === "creator" || status === "administrator") return { ok: true };
    return { ok: false, reason: "Нужны права администратора группы." };
  } catch {
    return { ok: false, reason: "Не удалось проверить права, попробуйте позже." };
  }
}
