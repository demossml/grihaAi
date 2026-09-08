/**
 * Pure, framework-free Telegram update handling. Kept independent of grammy so
 * the routing/authorisation logic is unit-testable.
 */

export interface TgUser {
  id: number;
  firstName?: string;
}

export interface TgDocument {
  file_id?: string;
}

export interface TgMessage {
  from?: TgUser;
  chat?: { id: number };
  text?: string;
  caption?: string;
  voice?: unknown;
  document?: TgDocument;
  photo?: Array<{ file_id?: string }>;
}

export interface TgUpdate {
  updateId: number;
  message?: TgMessage;
}

export interface GrishaAgent {
  (input: {
    message: string;
    userId: number;
    platform: "telegram";
    sessionKey: string;
    chatId?: string;
  }): Promise<string>;
}

/** Layer-1 pre-filter: return false to silently drop the message (0 tokens). */
export interface RulePreFilter {
  (input: { chatId: string; fromUserId: string; text: string }): boolean;
}

/** Handles Telegram /rules commands (chat scope + owner auto-substituted). */
export interface TelegramRulesHandler {
  (args: string, ctx: { chatId: string; userId: string }): string;
}

export interface TelegramReplySender {
  (chatId: number, text: string): Promise<void>;
}

function lastPhotoFileId(photo: Array<{ file_id?: string }>): string {
  const last = photo[photo.length - 1];
  return last?.file_id ?? "unknown";
}

export class TelegramBridge {
  constructor(
    private readonly allowedUserIds: number[],
    private readonly agent: GrishaAgent,
    private readonly sender: TelegramReplySender,
    private readonly options?: {
      prefilter?: RulePreFilter;
      rulesHandler?: TelegramRulesHandler;
    },
  ) {}

  private isProcessable(text: string, userId: number, chatId: number): boolean {
    const prefilter = this.options?.prefilter;
    if (!prefilter) return true;
    return prefilter({ chatId: String(chatId), fromUserId: String(userId), text });
  }

  isAllowed(userId: number): boolean {
    if (this.allowedUserIds.length === 0) return false;
    return this.allowedUserIds.includes(userId);
  }

  async handleUpdate(update: TgUpdate): Promise<{ handled: boolean; reason?: string }> {
    const msg = update.message;
    if (!msg?.chat) return { handled: false, reason: "no-message" };
    const userId = msg.from?.id;
    if (userId === undefined) return { handled: false, reason: "no-user" };
    if (!this.isAllowed(userId)) return { handled: false, reason: "not-allowed" };

    const chatId = msg.chat.id;
    const text = msg.text ?? "";

    if (text === "/start") {
      await this.sender(chatId, "Привет! Я Гриша — твой офисный ассистент.");
      return { handled: true };
    }
    if (text === "/new") {
      await this.sender(chatId, "Новая сессия начата.");
      return { handled: true };
    }
    if (text === "/status") {
      await this.sender(chatId, "Гриша работает.");
      return { handled: true };
    }
    if (text.startsWith("/rules")) {
      const handler = this.options?.rulesHandler;
      if (handler) {
        const args = text.slice("/rules".length).trim();
        const reply = handler(args, { chatId: String(chatId), userId: String(userId) });
        await this.sender(chatId, reply);
        return { handled: true };
      }
    }
    if (msg.voice) {
      await this.sender(chatId, "Голос получен (транскрипция пока не поддерживается).");
      return { handled: true };
    }
    if (msg.photo && msg.photo.length > 0) {
      const message = `Пользователь прислал изображение.\nfile_id: ${lastPhotoFileId(msg.photo)}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
      });
      await this.sender(chatId, response);
      return { handled: true };
    }
    if (msg.document?.file_id) {
      const message = `Пользователь прислал документ.\nfile_id: ${msg.document.file_id}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
      });
      await this.sender(chatId, response);
      return { handled: true };
    }
    if (!text) return { handled: false, reason: "empty" };

    if (!this.isProcessable(text, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };

    const response = await this.agent({
      message: text,
      userId,
      platform: "telegram",
      sessionKey: `tg:${userId}`,
      chatId: String(chatId),
    });
    await this.sender(chatId, response);
    return { handled: true };
  }
}
