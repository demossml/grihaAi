/**
 * G6 — pin bridge: контроллер регистрирует api (текущий bot instance), а
 * расширение шлёт /pin через этот канал (аналог file-send-bridge).
 */

export type TelegramPinApi = (chatId: number, messageId: number) => Promise<boolean>;

let pinApi: TelegramPinApi | null = null;

export function setTelegramPinApi(api: TelegramPinApi): void {
  pinApi = api;
}

export function getTelegramPinApi(): TelegramPinApi | null {
  return pinApi;
}
