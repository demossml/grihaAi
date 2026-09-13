/**
 * P02 — мост доставки cron-результатов в Telegram (registry на процесс,
 * паттерн file-send-bridge).
 *
 * CronService живёт в отдельном расширении и не знает про бота; telegram-bot
 * контроллер регистрирует сюда delivery/auth-check при своём создании, а
 * CronService читает их в момент доставки (bot пересоздаётся при реконнекте —
 * регистрация всегда свежая).
 */

export interface CronDeliveryResult {
  ok: boolean;
  /** true — ошибка не уйдёт при повторе (403/400); false — можно повторить. */
  permanent?: boolean;
  error?: string;
}

export type CronDelivery = (
  chatId: string,
  threadId: string | undefined,
  text: string,
) => Promise<CronDeliveryResult>;

export type CronMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked"
  | "unknown";

export type CronAuthCheck = (
  chatId: string,
  userId: string,
) => Promise<CronMemberStatus>;

let delivery: CronDelivery | null = null;
let authCheck: CronAuthCheck | null = null;

export function setCronDelivery(fn: CronDelivery | null): void {
  delivery = fn;
}

export function getCronDelivery(): CronDelivery | null {
  return delivery;
}

export function setCronAuthCheck(fn: CronAuthCheck | null): void {
  authCheck = fn;
}

export function getCronAuthCheck(): CronAuthCheck | null {
  return authCheck;
}
