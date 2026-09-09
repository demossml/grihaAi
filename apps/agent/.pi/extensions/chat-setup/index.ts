/**
 * chat-setup — онбординг чатов (safe_default + пресеты правил).
 *
 * Основная логика живёт в ChatSetupService/RulePresets/handlers и подключается
 * к Telegram-слою из расширения telegram-bot (my_chat_member, cs:-callbacks,
 * custom-текст в DM). Здесь регистрация происходит лениво по первому старту
 * бота — см. telegram-bot/index.ts (bootstrapChatSetup()).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function chatSetup(_pi: ExtensionAPI): void {
  // Сознательно пусто: точки входа — handlers.ts + telegram-bot/index.ts.
}
