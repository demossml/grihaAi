/**
 * Chat onboarding — типы состояния настройки чата.
 * Store: ~/.grish-ai/chat-setup.json (JSON, атомарная запись tmp+rename).
 */

export type SetupStatus = "pending" | "completed" | "skipped";

export interface ChatSetupRecord {
  chatId: string;
  chatTitle?: string;
  chatType: "group" | "supergroup" | "private" | "channel" | string;
  addedByUserId: string;
  status: SetupStatus;
  /** e.g. "team" | "secretary" | "listener" | "shop" | "only_me" | "custom" */
  presetId?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt?: string;
  /** Custom-путь: ждём описание правил от actor'а в DM. */
  waitingCustom?: boolean;
  /** Распарсенные (не подтверждённые) правила custom-потока. */
  pendingRules?: Array<{ key: string; value: string | boolean; kind: "hard" | "soft" }>;
}

export interface ChatSetupStoreFile {
  version: 1;
  chats: ChatSetupRecord[];
}
