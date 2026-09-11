/**
 * Мост доставки файлов из Telegram-субсессий в контроллер бота.
 *
 * Инструмент `send_file` исполняется ВНУТРИ изолированной субсессии (вне
 * контроллера), а фактическая отправка должна идти через текущий bot instance,
 * per-chat очередь и sendWithRetry (retry_after/429). Контроллер регистрирует
 * сюда отправитель при создании; инструмент читает его в момент вызова.
 * Та же форма «registry на процесс», что и session-files.ts.
 */

export interface TelegramFileSendInput {
  chatId: number;
  filePath: string;
  caption?: string;
  /** Тема форума (message_thread_id) — ответ в ту же тему. */
  threadId?: number;
  /** G2: фото (sendPhoto) или документ (sendDocument, default). */
  kind?: "photo" | "document";
}

export interface TelegramFileSendResult {
  ok: boolean;
  fileId?: string;
  messageId?: number;
  error?: string;
}

export type TelegramFileSender = (input: TelegramFileSendInput) => Promise<TelegramFileSendResult>;

/** ACL-проверка для send_file (по умолчанию — UsersService.isAllowed). */
export type TelegramFileAclCheck = (userId: string, chatId: string) => Promise<boolean> | boolean;

let fileSender: TelegramFileSender | null = null;
let aclCheck: TelegramFileAclCheck | null = null;

export function setTelegramFileSender(fn: TelegramFileSender | null): void {
  fileSender = fn;
}

export function getTelegramFileSender(): TelegramFileSender | null {
  return fileSender;
}

export function setTelegramFileAclCheck(fn: TelegramFileAclCheck | null): void {
  aclCheck = fn;
}

export function getTelegramFileAclCheck(): TelegramFileAclCheck | null {
  return aclCheck;
}
