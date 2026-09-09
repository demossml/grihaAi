/**
 * Pure, framework-free Telegram update handling. Kept independent of grammy so
 * the routing/authorisation logic is unit-testable.
 */

import type { InlineButton } from "../../../src/utils/telegram/session-files.js";
import { buildTelegramSessionKey } from "./session-key.js";

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
  /**
   * R1: заполнен ТОЛЬКО для group/supergroup контроллером
   * (getGroupConfigured). false = pending → silent. private — undefined.
   */
  groupConfigured?: boolean;
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

/** Layer-1 pre-filter: false/process=false → тихо дропнуть (0 токенов). */
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
    /** R1: false в группе → silent (pending-онбординг). private — undefined. */
    groupConfigured?: boolean;
  }):
    | boolean
    | {
        process: boolean;
        /** Архивариус: обработать, но не отвечать без @mention. */
        suppressReply?: boolean;
        /** Архивариус: сохранить сообщение/медиа в архив. */
        archive?: boolean;
      };
}

/** Handles Telegram /rules commands (chat scope + owner auto-substituted). */
export interface TelegramRulesHandler {
  (args: string, ctx: { chatId: string; userId: string }): string;
}

/** Resets the isolated session for a session key (`/new` в конкретном чате/теме). */
export interface TelegramResetHandler {
  (sessionKey: string, userId: number, chatId: string): Promise<void> | void;
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
      /** Прямой handler /setup ... — DM-only, сам шлёт keyboard через send. */
      setupCommandHandler?: (
        args: string,
        ctx: { chatId: string; userId: string; isPrivate: boolean },
        send: TelegramReplySender,
      ) => string | Promise<string>;
      /** D9: подсказка в /start про pending-группы (private). */
      pendingGroupsHint?: (userId: string) => string | Promise<string>;
      /** D3: STT-транскрипция голосового ДО агента. */
      transcribeVoice?: (
        fileId: string,
        meta: { chatId: string; userId: string },
      ) => Promise<string>;
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
      /** Архивариус: сохранить текст/медиа в chat_archive (тихо, без ack). */
      archiveHandler?: (
        msg: TgMessage,
        ctx: { chatId: string; userId: string; kind: "text" | "photo" | "document" },
      ) => Promise<{ stored: boolean }>;
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
    return this.evaluateInput(text, userId, chatId, msg, chatType).process;
  }

  /** Полная форма решения Layer-1: process + подавление ответа + архив. */
  private evaluateInput(
    text: string,
    userId: number,
    chatId: number,
    msg: TgMessage,
    chatType: string,
  ): { process: boolean; suppressReply: boolean; archive: boolean } {
    const prefilter = this.options?.prefilter;
    if (!prefilter) return { process: true, suppressReply: false, archive: false };
    const isGroup = chatType === "group" || chatType === "supergroup";
    const result = prefilter({
      chatId: String(chatId),
      fromUserId: String(userId),
      text,
      isGroup,
      fromIsBot: msg.fromIsBot,
      isService: msg.isService,
      botMentioned: msg.botMentioned,
      repliedToBot: msg.repliedToBot,
      startsWithOtherMention: msg.startsWithOtherMention,
      // R1: pending-группа → false (silent). private → undefined (не применяется).
      groupConfigured: isGroup ? (msg.groupConfigured ?? false) : undefined,
    });
    if (typeof result === "boolean") {
      return { process: result, suppressReply: false, archive: false };
    }
    return {
      process: result.process !== false,
      suppressReply: result.suppressReply === true,
      archive: result.archive === true,
    };
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
      // D9: в private — короткий hint про pending-группы, без спама клавиатурами.
      let extra = "";
      if (chatType === "private" && this.options?.pendingGroupsHint) {
        try {
          extra = await this.options.pendingGroupsHint(String(userId));
        } catch {
          /* ignore */
        }
      }
      await send(chatId, `Привет! Я Гриша — твой офисный ассистент.${extra}`);
      return { handled: true };
    }
    if (text === "/new") {
      // D2: /new сбрасывает ТОЛЬКО сессию текущего чата(+темы), не все чаты.
      const sessionKey = buildTelegramSessionKey({
        userId,
        chatId,
        threadId: msg.threadId,
      });
      await this.options?.resetHandler?.(sessionKey, userId, String(chatId));
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
    // /setup ... — настройка групп: в DM — все pending; в группе — только эта
    // группа (только creator/administrator, Пакет B). Handler сам шлёт keyboard.
    if (text === "/setup" || text.startsWith("/setup ")) {
      const handler = this.options?.setupCommandHandler;
      if (handler) {
        const args = text.slice("/setup".length).trim();
        const reply = await handler(
          args,
          { chatId: String(chatId), userId: String(userId), isPrivate: chatType === "private" },
          send,
        );
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
      // D3: голос транскрибируется ДО агента (STT pipeline), агенту идёт текст.
      const fileId = msg.voice.file_id;
      if (!fileId) return { handled: false, reason: "empty" };
      const placeholder = msg.caption ?? "voice";
      if (!this.isProcessable(placeholder, userId, chatId, msg, chatType)) {
        return { handled: true, reason: "blocked-by-rules" };
      }
      this.options?.beforeAgent?.(chatId);

      let transcript: string;
      if (!this.options?.transcribeVoice) {
        await send(chatId, "Голосовые пока недоступны.");
        return { handled: true, reason: "stt-unavailable" };
      }
      try {
        transcript = await this.options.transcribeVoice(fileId, {
          chatId: String(chatId),
          userId: String(userId),
        });
      } catch {
        await send(chatId, "Не удалось распознать голос.");
        return { handled: true, reason: "stt-failed" };
      }
      const text2 = transcript.trim();
      if (!text2) {
        await send(chatId, "Не удалось распознать голос.");
        return { handled: true, reason: "stt-empty" };
      }

      // Повторный prefilter по РАСПОЗНАННОМУ тексту (mention-правила и т.д.).
      if (!this.isProcessable(text2, userId, chatId, msg, chatType)) {
        return { handled: true, reason: "blocked-by-rules" };
      }

      const response = await this.agent({
        message: text2,
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({
          userId,
          chatId,
          threadId: msg.threadId,
        }),
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.photo && msg.photo.length > 0) {
      const message = `Пользователь прислал изображение.\nfile_id: ${lastPhotoFileId(msg.photo)}\nПодпись: ${msg.caption ?? "нет"}`;
      const gate = this.evaluateInput(message, userId, chatId, msg, chatType);
      if (gate.archive) {
        // Архивариус: OCR/архив ВСЕХ фото, тихо (без ack), ответ — только на @mention.
        if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
        this.options?.beforeAgent?.(chatId);
        await this.archiveQuietly(msg, chatId, userId, "photo");
      } else {
        // Обычный путь: сначала попытка инжеста чеков/накладных (§12 порядок).
        // R1/R6: в pending-группе инжест не открываем (silent, нет side-channel).
        const ingest = msg.groupConfigured === false ? undefined : this.options?.documentIngest;
        if (ingest) {
          const ingested = await ingest(msg, { chatId: String(chatId), userId: String(userId) });
          if (ingested?.ack) {
            await send(chatId, ingested.ack);
            return { handled: true, reason: "document-ingested" };
          }
        }
        if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
        this.options?.beforeAgent?.(chatId);
      }
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({ userId, chatId, threadId: msg.threadId }),
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (msg.document?.file_id) {
      const message = `Пользователь прислал документ.\nfile_id: ${msg.document.file_id}\nПодпись: ${msg.caption ?? "нет"}`;
      const gate = this.evaluateInput(message, userId, chatId, msg, chatType);
      if (gate.archive) {
        // Архивариус: OCR/архив всех документов, тихо, ответ — только на @mention.
        if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
        this.options?.beforeAgent?.(chatId);
        await this.archiveQuietly(msg, chatId, userId, "document");
      } else {
        const ingest = msg.groupConfigured === false ? undefined : this.options?.documentIngest;
        if (ingest) {
          const ingested = await ingest(msg, { chatId: String(chatId), userId: String(userId) });
          if (ingested?.ack) {
            await send(chatId, ingested.ack);
            return { handled: true, reason: "document-ingested" };
          }
        }
        if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
        this.options?.beforeAgent?.(chatId);
      }
      const response = await this.agent({
        message,
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({ userId, chatId, threadId: msg.threadId }),
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
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
        sessionKey: buildTelegramSessionKey({ userId, chatId, threadId: msg.threadId }),
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
        sessionKey: buildTelegramSessionKey({ userId, chatId, threadId: msg.threadId }),
        chatId: String(chatId),
        threadId: msg.threadId,
      });
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    }
    if (!text) return { handled: false, reason: "empty" };

    const gate = this.evaluateInput(text, userId, chatId, msg, chatType);
    if (!gate.process) return { handled: true, reason: "blocked-by-rules" };

    // Индикатор «печатает…» сразу после приёма, до обработки (в т.ч. в режиме
    // архивариуса, где текстового ответа может не быть вообще).
    this.options?.beforeAgent?.(chatId);
    if (gate.archive) {
      // Архивариус: тихо сохранить текст (с автором/временем/темой), агент
      // обрабатывает контекст, но ответ подавляется без @mention.
      await this.archiveQuietly(msg, chatId, userId, "text");
    }
    const response = await this.agent({
      message: text,
      userId,
      platform: "telegram",
      sessionKey: buildTelegramSessionKey({ userId, chatId, threadId: msg.threadId }),
      chatId: String(chatId),
      threadId: msg.threadId,
    });
    if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
    await this.sendReply(chatId, response, msg.threadId);
    return { handled: true };
  }

  /** Тихое сохранение в архив: ошибки архива не роняют обработку. */
  private async archiveQuietly(
    msg: TgMessage,
    chatId: number,
    userId: number,
    kind: "text" | "photo" | "document",
  ): Promise<void> {
    try {
      await this.options?.archiveHandler?.(msg, {
        chatId: String(chatId),
        userId: String(userId),
        kind,
      });
    } catch (err: unknown) {
      console.error(
        "[telegram-bot] archive failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
