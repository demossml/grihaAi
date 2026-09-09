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
  chat?: { id: number; type?: string };
  messageId?: number;
  /** Тема форума (message_thread_id); undefined в обычных группах/DM. */
  threadId?: string;
  isForum?: boolean;
  text?: string;
  caption?: string;
  voice?: { file_id?: string };
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
  };
  photo?: Array<{ file_id?: string; file_unique_id?: string }>;
  contact?: { first_name?: string; last_name?: string; phone_number?: string };
  location?: { latitude?: number; longitude?: number };
  /** Pre-filter флаги (вычисляются в toTgUpdate из grammy-ctx). */
  fromIsBot?: boolean;
  isService?: boolean;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  startsWithOtherMention?: boolean;
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
    /** Тема форума, в которой пришло сообщение (для контекста/scope). */
    threadId?: string;
  }): Promise<GrishaAgentReply>;
}

/** Layer-1 pre-filter: return false to silently drop the message (0 tokens). */
export interface RulePreFilter {
  (input: {
    chatId: string;
    fromUserId: string;
    text: string;
    isGroup?: boolean;
    fromIsBot?: boolean;
    isService?: boolean;
    botMentioned?: boolean;
    repliedToBot?: boolean;
    startsWithOtherMention?: boolean;
  }): boolean;
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
  /** Тема форума, в которую слать ответ (из входящего сообщения). */
  threadId?: string;
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
      /** Реакция на исходное сообщение (лёгкое подтверждение «принято»). */
      react?: (chatId: number, messageId: number, emoji: string) => void;
      /** Early ACL: вызывается ДО prefilter/агента. false → deny (см. §3 политики). */
      aclCheck?: (userId: string, chatId: string) => boolean | Promise<boolean>;
      /** Прямой handler /users ... (без LLM, как /rules). */
      usersCommandHandler?: (
        args: string,
        ctx: { chatId: string; userId: string },
      ) => string | Promise<string>;
      /** Прямой handler /setup ... (список pending-чатов). */
      setupCommandHandler?: (
        args: string,
        ctx: { chatId: string; userId: string },
      ) => string | Promise<string>;
      /** Перехват custom-текста онбординга в DM; true → сообщение обработано. */
      customSetupInterceptor?: (
        input: { userId: string; chatId: string; text: string; isPrivate: boolean },
        send: TelegramReplySender,
      ) => Promise<boolean>;
      /** Инжест чеков/накладных (photo/document); ack → отправить и не звать агента. */
      documentIngest?: (
        msg: TgMessage,
        ctx: { chatId: string; userId: string },
      ) => Promise<{ ack?: string } | null>;
    },
  ) {}

  /** Send a reply with all attached extras (file, caption, buttons). */
  private sendReply(chatId: number, reply: GrishaAgentReply, threadId?: string): Promise<void> {
    return this.sender(chatId, reply.text, reply.filePath, {
      inlineButtons: reply.inlineButtons,
      documentCaption: reply.documentCaption,
      threadId,
    });
  }

  /** Sender, привязанный к теме входящего сообщения (ответ — в ту же тему). */
  private makeSender(threadId?: string): TelegramReplySender {
    return (chatId, text, filePath, extra) =>
      this.sender(chatId, text, filePath, { ...extra, threadId });
  }

  private isProcessable(text: string, userId: number, chatId: number, msg: TgMessage, chatType: string): boolean {
    const prefilter = this.options?.prefilter;
    if (!prefilter) return true;
    return prefilter({
      chatId: String(chatId),
      fromUserId: String(userId),
      text,
      isGroup: chatType === "group" || chatType === "supergroup",
      fromIsBot: msg.fromIsBot,
      isService: msg.isService,
      botMentioned: msg.botMentioned,
      repliedToBot: msg.repliedToBot,
      startsWithOtherMention: msg.startsWithOtherMention,
    });
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

    const chatId = msg.chat.id;
    const chatType = msg.chat.type ?? "private";
    const text = msg.text ?? "";
    // Все ответы этого апдейта уходят в тему входящего сообщения.
    const send = this.makeSender(msg.threadId);

    // ── Early ACL: как можно раньше, ДО prefilter/агента (п.3 спеки). ────────
    if (this.options?.aclCheck) {
      const allowed = await this.options.aclCheck(String(userId), String(chatId));
      if (!allowed) {
        // Политика v1: private → короткий отказ (если не ACL_DENY_REPLY=0);
        // группа — молча. LLM не вызывается.
        if (chatType === "private" && process.env.ACL_DENY_REPLY !== "0") {
          await send(chatId, "Нет доступа.");
        }
        return { handled: true, reason: "acl-denied" };
      }
    } else if (!this.isAllowed(userId)) {
      return { handled: false, reason: "not-allowed" };
    }

    if (text === "/start") {
      await send(chatId, "Привет! Я Гриша — твой офисный ассистент.");
      return { handled: true };
    }
    if (text === "/new") {
      // Real session reset: dispose the current AgentSession and start a fresh
      // one on the next message. Profile/memory/rules are not touched.
      await this.options?.resetHandler?.(userId, String(chatId));
      await send(chatId, "Новая сессия начата.");
      return { handled: true };
    }
    if (text === "/status") {
      await send(chatId, "Гриша работает.");
      return { handled: true };
    }
    if (text.startsWith("/rules")) {
      const handler = this.options?.rulesHandler;
      if (handler) {
        const args = text.slice("/rules".length).trim();
        const reply = handler(args, { chatId: String(chatId), userId: String(userId) });
        await send(chatId, reply);
        return { handled: true };
      }
    }
    // Текстовый фолбэк /approve <id> / /deny <id> (основной путь — inline-кнопки).
    const approvalMatch = /^\/(approve|deny)(?:\s+(.+))?$/.exec(text);
    if (approvalMatch) {
      const handler = this.options?.approvalHandler;
      if (!handler) {
        await send(chatId, "Подтверждения недоступны.");
        return { handled: true };
      }
      const id = approvalMatch[2]?.trim();
      const reply = id
        ? handler(approvalMatch[1] as "approve" | "deny", id)
        : `Укажите id: /${approvalMatch[1]} <id>`;
      await send(chatId, reply);
      return { handled: true };
    }
    // /users ... — прямой handler без LLM (guard canManage внутри handler'а).
    if (text === "/users" || text.startsWith("/users ")) {
      const handler = this.options?.usersCommandHandler;
      if (handler) {
        const args = text.slice("/users".length).trim();
        const reply = await handler(args, { chatId: String(chatId), userId: String(userId) });
        await send(chatId, reply);
        return { handled: true };
      }
    }
    // /setup ... — статус онбординга чатов (без LLM).
    if (text === "/setup" || text.startsWith("/setup ")) {
      const handler = this.options?.setupCommandHandler;
      if (handler) {
        const args = text.slice("/setup".length).trim();
        const reply = await handler(args, { chatId: String(chatId), userId: String(userId) });
        await send(chatId, reply);
        return { handled: true };
      }
    }
    // Custom-онбординг: текст от actor'а в DM (waitingCustom) перехватывается
    // до агента — детерминированный парсер + кнопки подтверждения.
    if (text && !text.startsWith("/")) {
      const interceptor = this.options?.customSetupInterceptor;
      if (interceptor) {
        const intercepted = await interceptor(
          {
            userId: String(userId),
            chatId: String(chatId),
            text,
            isPrivate: chatType === "private",
          },
          send,
        );
        if (intercepted) return { handled: true, reason: "setup-custom-text" };
      }
    }
    if (msg.voice) {
      // Голосовое уходит агенту тем же паттерном, что фото/документ: агент сам
      // решит вызвать tool transcribe_voice с этим fileId (в т.ч. логику
      // переспроса при низкой confidence — см. voice-intake/SKILL.md).
      const message = `Пользователь прислал голосовое сообщение.\nfile_id: ${msg.voice.file_id ?? "unknown"}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.photo && msg.photo.length > 0) {
      // Документ/чек: сначала попытка инжеста в expenses store (§12 порядок).
      const ingest = this.options?.documentIngest;
      if (ingest) {
        const ingested = await ingest(msg, { chatId: String(chatId), userId: String(userId) });
        if (ingested?.ack) {
          await send(chatId, ingested.ack);
          return { handled: true, reason: "document-ingested" };
        }
      }
      const message = `Пользователь прислал изображение.\nfile_id: ${lastPhotoFileId(msg.photo)}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.document?.file_id) {
      const ingest = this.options?.documentIngest;
      if (ingest) {
        const ingested = await ingest(msg, { chatId: String(chatId), userId: String(userId) });
        if (ingested?.ack) {
          await send(chatId, ingested.ack);
          return { handled: true, reason: "document-ingested" };
        }
      }
      const message = `Пользователь прислал документ.\nfile_id: ${msg.document.file_id}\nПодпись: ${msg.caption ?? "нет"}`;
      if (!this.isProcessable(message, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.contact) {
      // Контакт уходит агенту как текст: агент сам решит, вызвать ли
      // contact_upsert (crm) через обычный tool-цикл — approval/rules-логику
      // не обходим. Реакция 👍 — тривиальное подтверждение приёма на исходном
      // сообщении (содержательный ответ всё равно приходит текстом от агента).
      if (msg.messageId !== undefined) this.options?.react?.(chatId, msg.messageId, "👍");
      const message = `Пользователь поделился контактом.\nИмя: ${msg.contact.first_name ?? ""} ${msg.contact.last_name ?? ""}\nТелефон: ${msg.contact.phone_number ?? "не указан"}`;
      if (!this.isProcessable(message, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.location) {
      // Геолокация — тот же путь через агента: он сам решит, вызывать ли
      // travel_item_add (travel) или ответить контекстно.
      const message = `Пользователь поделился геолокацией: ${msg.location.latitude ?? "?"}, ${msg.location.longitude ?? "?"}`;
      if (!this.isProcessable(message, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };
      this.options?.beforeAgent?.(chatId);
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: `tg:${userId}`,
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (!text) return { handled: false, reason: "empty" };

    if (!this.isProcessable(text, userId, chatId, msg, chatType)) return { handled: true, reason: "blocked-by-rules" };

    this.options?.beforeAgent?.(chatId);
    const response = await this.agent({
      message: text,
      userId,
      platform: "telegram",
      sessionKey: `tg:${userId}`,
      chatId: String(chatId),
      threadId: msg.threadId,
    });
    await this.sendReply(chatId, response, msg.threadId);
    return { handled: true };
  }
}
