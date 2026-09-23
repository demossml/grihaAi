/**
 * S2 — флаг auto_reminders на группу (structured rule key=auto_reminders, scope=chat).
 *
 * default ON если не задан. Хранится в user_rules (не отдельный sqlite) —
 * консистентно с notify_poor_ocr / notify_expense_brief.
 */
import type { UserRule } from "@griha/shared-types";
import { getUserRulesService } from "./UserRulesService.js";

export const AUTO_REMINDERS_KEY = "auto_reminders";

/** Чистое чтение флага из правил чата (last-value wins; default ON). */
export function isAutoRemindersEnabledFromRules(rules: UserRule[]): boolean {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r.key !== AUTO_REMINDERS_KEY) continue;
    const v = r.value;
    if (v === false || v === "false" || v === 0) return false;
    if (v === true || v === "true" || v === 1) return true;
  }
  return true; // не задано → ON
}

/** Toggle флага на группу (structured rule). */
export function setAutoReminders(
  chatId: string,
  enabled: boolean,
  svc = getUserRulesService(),
): void {
  svc.upsertStructuredRule(chatId, AUTO_REMINDERS_KEY, enabled, {
    source: "auto_reminders",
  });
}

/** Синхронное чтение из сервиса (hard+soft) — для fireDue path. */
export function isAutoRemindersEnabled(chatId: string): boolean {
  const svc = getUserRulesService();
  return isAutoRemindersEnabledFromRules([
    ...svc.getHardRules(chatId),
    ...svc.getSoftRules(chatId),
  ]);
}
