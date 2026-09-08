/**
 * Pure, framework-free Telegram update handling. Kept independent of grammy so
 * the routing/authorisation logic is unit-testable.
 */

import type { InlineButton } from "../../../src/utils/telegram/session-files.js";

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

export interface GrishaAgentReply {
  text: string;
  /** Optional path to a generated file to send as a document (99% of replies omit it). */
  filePath?: string;
  /** Optional Telegram caption for the document. */
  documentCaption?: string;
  /** Optional inline keyboard rows (e.g. approval buttons). */
  inlineButtons?: InlineButton[][];
}

export interface GrishaAgent {
  (input: {
    message: string;
    userId: number;
    platform: "telegram";
    sessionKey: string;
    chatId?: string;
  }): Promise<GrishaAgentReply>;
}

/** Layer-1 pre-filter: return false to silently drop the message (0 tokens). */
export interface RulePreFilter {
  (input: { chatId: string; fromUserId: string; text: string }): boolean;
}

/** Handles Telegram /rules commands (chat scope + owner auto-substituted). */
export interface TelegramRulesHandler {
  (args: string, ctx: { chatId: string; userId: string }): string;
}

/** Resets the isolated session for a user (`/new`). */
export interface TelegramResetHandler {
  (userId: number, chatId: string): Promise<void> | void;
}

/** Shared approval decision (approve/deny by id) — business logic lives in approval-gate. */
export interface TelegramApprovalHandler {
  (action: "approve" | "deny", id: string): string;
}

/** Extra payload attached to a Telegram reply. */
export interface TelegramSendExtra {
  inlineButtons?: InlineButton[][];
  documentCaption?: string;
}

export interface TelegramReplySender {
  (chatId: number, text: string, filePath?: string, extra?: TelegramSendExtra): Promise<void>;
}

/**
 * Escapes text for Telegram parse_mode=HTML and converts the simple markdown
 * the agent may emit (`**bold**`, `code`) into HTML tags. Only balanced,
 * non-empty pairs are converted; everything else is escaped and sent as-is.
 * No italic/underline conversion — `__x__`/`*x*` patterns are too common in
 * ordinary text to transform safely.
 */
export function formatTelegramHtml(input: string): string {
  let out = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  return out;
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
      resetHandler?: TelegramResetHandler;
      approvalHandler?: TelegramApprovalHandler;
      /** Fired right before the agent is asked to reply (chat action signal). */
      beforeAgent?: (chatId: number) => void;
    },
  ) {}

  /** Send a reply with all attached extras (file, caption, buttons). */
  private async sendReply(chatId: number, reply: GrishaAgentReply): Promise<void> {
    await this.sender(chatId, reply.text, reply.filePath, {
      inlineButtons: reply.inlineButtons,
      documentCaption: reply.documentCaption,
    });
  }

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
      // Real session reset: dispose the current AgentSession and start a fresh
      // one on the next message. Profile/memory/rules are not touched.
      await this.options?.resetHandler?.(userId, String(chatId));
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
    // Текстовый фолбэк /approve <id> / /deny <id> (основной путь — inline-кнопки).
    const approvalMatch = /^\/(approve|deny)(?:\s+(.+))?$/.exec(text);
    if (approvalMatch) {
      const handler = this.options?.approvalHandler;
      if (!handler) {
        await this.sender(chatId, "Подтверждения недоступны.");
        return { handled: true };
      }
      const id = approvalMatch[2]?.trim();
      const reply = id
        ? handler(approvalMatch[1] as "approve" | "deny", id)
        : `Укажите id: /${approvalMatch[1]} <id>`;
      await this.sender(chatId, reply);
      return { handled: true };
    }
    if (msg.voice) {
      await this.sender(chatId, "Голос получен (транскрипция пока не поддерживается).");
      return { handled: true };
    }
    if (msg.photo && msg.photo.length > 0) {
      const message = `Пользователь прислал изображение.\nfile_id: ${lastPhotoFileId(msg.photo)}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
      });
      await this.sendReply(chatId, response);
      return { handled: true };
    }
    if (msg.document?.file_id) {
      const message = `Пользователь прислал документ.\nfile_id: ${msg.document.file_id}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
      });
      await this.sendReply(chatId, response);
      return { handled: true };
    }
    if (!text) return { handled: false, reason: "empty" };

    if (!this.isProcessable(text, userId, chatId)) return { handled: true, reason: "blocked-by-rules" };

    this.options?.beforeAgent?.(chatId);
    const response = await this.agent({
      message: text,
      userId,
      platform: "telegram",
      sessionKey: `tg:${userId}`,
      chatId: String(chatId),
    });
    await this.sendReply(chatId, response);
    return { handled: true };
  }
}
