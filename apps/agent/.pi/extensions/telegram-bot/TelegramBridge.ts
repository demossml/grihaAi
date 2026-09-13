/**
 * Pure, framework-free Telegram update handling. Kept independent of grammy so
 * the routing/authorisation logic is unit-testable.
 */

import type { InlineButton } from "../../../src/utils/telegram/session-files.js";
import { buildTelegramSessionKey } from "./session-key.js";
import { startTypingHeartbeat } from "./typing-heartbeat.js";
import {
  MediaGroupBuffer,
  type AlbumBatch,
  type AlbumItem,
} from "./media-group-buffer.js";
import { resolveTelegramAccess } from "./telegram-acl.js";
import {
  EMPTY_REPLY_MESSAGE,
  TURN_ERROR_MESSAGE,
  TURN_HEAVY_MS,
  TURN_MS,
  TURN_TIMEOUT_MESSAGE,
  TurnTimeoutError,
  withTurnTimeout,
} from "./agent-turn-timeout.js";

export interface TgUser {
  id: number;
  firstName?: string;
}

/**
 * P03: служебный отправитель анонимных администраторов групп
 * (GroupAnonymousBot) — один и тот же id для ВСЕХ групп и админов.
 * LIVE-UNVERIFIED: реальный payload сверяется на проде.
 */
export const TELEGRAM_ANONYMOUS_ADMIN_ID = 1087968824;

/** sender_chat (channel_post/собственное имя отправителя). */
export interface TgSenderChat {
  id?: number;
  title?: string;
}

export interface TgDocument {
  file_id?: string;
}

export interface TgMessage {
  from?: TgUser;
  /** Канал/группа-отправитель (channel_post); from при этом может отсутствовать. */
  senderChat?: TgSenderChat;
  chat?: { id: number; type?: string };
  messageId?: number;
  /** Тема форума (message_thread_id); undefined в обычных группах/DM. */
  threadId?: string;
  isForum?: boolean;
  /**
   * R1: заполнен ТОЛЬКО для group/supergroup/channel контроллером
   * (getGroupConfigured). false = pending → silent. private — undefined.
   */
  groupConfigured?: boolean;
  text?: string;
  caption?: string;
  /** Правка (edited_message/edited_channel_post): архив хранит ревизии. */
  isEdited?: boolean;
  editDate?: number;
  voice?: { file_id?: string; file_unique_id?: string; duration?: number; mime_type?: string };
  video?: { file_id?: string; file_unique_id?: string; duration?: number; mime_type?: string };
  videoNote?: { file_id?: string; file_unique_id?: string; duration?: number };
  audio?: { file_id?: string; file_unique_id?: string; duration?: number; mime_type?: string; file_name?: string };
  /** media_group_id альбома (G1): item обрабатывается батчем. */
  mediaGroupId?: string;
  /** Ответ на сообщение (G8: reply context для агента). */
  replyTo?: { messageId?: number; text?: string; caption?: string; fromUserId?: string };
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
  /** Единый update kind (PROMPT 02): message|channel_post|edited_message|edited_channel_post. */
  updateKind?: "message" | "channel_post" | "edited_message" | "edited_channel_post";
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
  /** R3: отправить ТОЛЬКО файл — без текста, подписи и кнопок. */
  attachmentOnly?: boolean;
  /** R3: ключ идемпотентности (пул уже погасил дубли по нему). */
  dedupeKey?: string;
}

/**
 * Результат единого медиа-конвейера (photo/document): download → OCR →
 * archive/expense. Контроллер сам решает, гонять ли OCR (allowed/archive/policy).
 */
export interface ProcessMediaResult {
  /** Политика не требует OCR → конвейер пропущен (нет allowed/archive/policy). */
  skipped?: boolean;
  /** Download/OCR упали (retry уже поставлен контроллером в media-retry). */
  failed?: boolean;
  rawText?: string;
  confidence?: number;
  expenseId?: string;
  ingestedExpense?: boolean;
  /** R-GR-8: предупреждение о плохом OCR (только по policy-флагу чата). */
  notify?: string;
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
    /** Контекст правил чата для агента (R-GR-3), передаётся каждый ход. */
    rulesContext?: string;
  }): Promise<GrishaAgentReply>;
}

/** Layer-1 pre-filter: false/process=false → тихо дропнуть (0 токенов). */
export interface RulePreFilter {
  (input: {
    chatId: string;
    fromUserId: string;
    text: string;
    isGroup?: boolean;
    isChannel?: boolean;
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
  (
    args: string,
    ctx: { chatId: string; userId: string; chatType?: string },
    deps?: {
      /** server-side проверка статуса actor'а (PROMPT 08). */
      getChatMember?: (chatId: number, userId: number) => Promise<{ status: string }>;
    },
  ): string | Promise<string>;
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

/** Базовый текст промпта по типу медиа. */
function mediaBaseText(kind: "photo" | "document" | "voice" | "video" | "video_note" | "audio"): string {
  switch (kind) {
    case "photo":
      return "Пользователь прислал изображение.";
    case "voice":
      return "Пользователь прислал голосовое сообщение.";
    case "video":
      return "Пользователь прислал видео.";
    case "video_note":
      return "Пользователь прислал видеокружок (video_note).";
    case "audio":
      return "Пользователь прислал аудио.";
    default:
      return "Пользователь прислал документ.";
  }
}

/**
 * Промпт агента для входящего медиа: распознанный текст OCR/STT в центре,
 * file_id — справочно внизу (B2: агент видит содержимое, а не голый id).
 */
function buildMediaAgentMessage(
  kind: "photo" | "document" | "voice" | "video" | "video_note" | "audio",
  msg: TgMessage,
  fileId: string,
  media: ProcessMediaResult | null,
): string {
  const base = mediaBaseText(kind);
  if (media?.failed) {
    return [
      base,
      msg.caption ? `Подпись: ${msg.caption}` : null,
      kind === "voice" || kind === "audio" || kind === "video_note"
        ? "Не удалось распознать голос."
        : "Не удалось распознать изображение.",
      `telegram_file_id: ${fileId}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const ocrText = media?.rawText?.trim();
  const mime = msg.document?.mime_type ?? "";
  const fileName = msg.document?.file_name ?? "";
  const isPdf = kind === "document" && (/pdf/i.test(mime) || /\.pdf$/i.test(fileName));
  const isAudioLike = kind === "voice" || kind === "audio" || kind === "video_note";
  const textLabel = isAudioLike ? "Распознанный текст (STT):" : "Распознанный текст (OCR):";
  return [
    base,
    msg.caption ? `Подпись: ${msg.caption}` : null,
    ocrText
      ? `${textLabel}\n${ocrText}`
      : isPdf
        ? "OCR: PDF не поддерживается vision-моделью — нужна ручная проверка документа."
        : isAudioLike
          ? "STT не извлёк текст (нужна проверка или STT недоступен)."
          : kind === "video"
            ? "Видео сохранено; покадровое распознавание не выполняется (нужна ручная проверка)."
            : "OCR не извлёк текст (нужна проверка или vision недоступен).",
    media?.expenseId ? `Документ сохранён в expenses id=${media.expenseId}` : null,
    `telegram_file_id: ${fileId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** G1: элемент альбома из TgMessage. */
export function albumItemOf(msg: TgMessage): AlbumItem | null {
  const item = (kind: AlbumItem["kind"], fileId: string, fileUniqueId: string, mimeType?: string, duration?: number): AlbumItem => ({
    updateId: 0,
    messageId: msg.messageId ?? 0,
    fileId,
    fileUniqueId,
    kind,
    mimeType,
    caption: msg.caption,
    duration,
  });
  if (msg.photo?.length) {
    const last = msg.photo[msg.photo.length - 1];
    if (last.file_id) return item("photo", last.file_id, last.file_unique_id ?? last.file_id, "image/jpeg");
  }
  if (msg.document?.file_id) {
    return item("document", msg.document.file_id, msg.document.file_unique_id ?? msg.document.file_id, msg.document.mime_type);
  }
  if (msg.voice?.file_id) {
    return item("voice", msg.voice.file_id, msg.voice.file_unique_id ?? msg.voice.file_id, msg.voice.mime_type ?? "audio/ogg", msg.voice.duration);
  }
  if (msg.video?.file_id) {
    return item("video", msg.video.file_id, msg.video.file_unique_id ?? msg.video.file_id, msg.video.mime_type, msg.video.duration);
  }
  if (msg.videoNote?.file_id) {
    return item("video_note", msg.videoNote.file_id, msg.videoNote.file_unique_id ?? msg.videoNote.file_id, "video/mp4", msg.videoNote.duration);
  }
  if (msg.audio?.file_id) {
    return item("audio", msg.audio.file_id, msg.audio.file_unique_id ?? msg.audio.file_id, msg.audio.mime_type ?? "audio/mpeg", msg.audio.duration);
  }
  return null;
}

/** G1: промпт агента для альбома (один на весь batch). */
export function buildAlbumAgentMessage(
  batch: AlbumBatch,
  media: ProcessMediaResult | null | undefined,
): string {
  const lines: string[] = [
    `Пользователь прислал альбом из ${batch.items.length} файлов.`,
  ];
  if (batch.caption) lines.push(`Подпись: ${batch.caption}`);
  const texts = (media?.rawText ?? "")
    .split(/\n?={3,}\n?|\n?---\n?/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (texts.length > 0) {
    lines.push("Распознанный текст (OCR) по файлам:");
    texts.forEach((t, i) => lines.push(`[файл ${i + 1}]\n${t}`));
  } else {
    lines.push("OCR не извлёк текст (нужна проверка или vision недоступен).");
  }
  if (media?.expenseId) lines.push(`Документы сохранены в expenses (id последнего: ${media.expenseId})`);
  lines.push(`telegram_media_group_id: ${batch.groupId}`);
  return lines.join("\n");
}

/** G8: контекст reply — агенту всегда видно, на что отвечают. */
export function withReplyContext(message: string, msg: TgMessage): string {
  const rt = msg.replyTo;
  if (!rt) return message;
  const content = rt.text ?? rt.caption ?? "";
  if (!content.trim()) return message;
  const block = [
    "[REPLY_TO]",
    `message_id: ${rt.messageId ?? "?"}`,
    `текст: ${content}`,
    "[/REPLY_TO]",
  ].join("\n");
  return `${block}\n\n${message}`;
}

export class TelegramBridge {
  private readonly agent: GrishaAgent;

  /** G1: буфер альбомов + контекст gate на группу. */
  private albumBuffer: MediaGroupBuffer | null = null;
  private readonly albumGates = new Map<
    string,
    {
      gate: { process: boolean; suppressReply: boolean; archive: boolean; rulesContext: string };
      chatId: number;
      userId: number;
      chatType: string;
      send: TelegramReplySender;
      msg: TgMessage;
    }
  >();

  constructor(
    private readonly allowedUserIds: number[],
    agent: GrishaAgent,
    private readonly sender: TelegramReplySender,
    private readonly options?: {
      prefilter?: RulePreFilter;
      rulesHandler?: TelegramRulesHandler;
      /** server-side getChatMember для авторизации мутаций /rules (PROMPT 08). */
      rulesGetChatMember?: (chatId: number, userId: number) => Promise<{ status: string }>;
      resetHandler?: TelegramResetHandler;
      approvalHandler?: TelegramApprovalHandler;
      /** Fired right before the agent is asked to reply (chat action signal). */
      beforeAgent?: (chatId: number) => void;
      /** Реакция на исходное сообщение (лёгкое подтверждение «принято»). */
      react?: (chatId: number, messageId: number, emoji: string) => void;
      /** Early ACL: вызывается ДО prefilter/агента. false → deny (см. §3 политики). */
      aclCheck?: (userId: string, chatId: string) => boolean | Promise<boolean>;
      /**
       * A1–A4: membership-ACL (group=участие, private=только явный список).
       * При наличии — заменяет aclCheck для agent-path; без него — legacy. */
      telegramAccess?: {
        isAllowedPrivate: (userId: string) => Promise<boolean>;
        getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
      };
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
      /**
       * Единый медиа-конвейер (photo/document): download → OCR (VisionExtractor) →
       * archive/expense. Вызывается ДО агента на allowed/archive ходах — агенту
       * уходит распознанный текст, а не голый file_id (B2/B4).
       * Контроллер решает по правилам чата, гонять ли OCR (skipped при отказе).
       */
      processMedia?: (
        msg: TgMessage,
        ctx: {
          chatId: string;
          userId: string;
          kind: "photo" | "document" | "voice" | "video" | "video_note" | "audio";
          allowed: boolean;
          archive: boolean;
        },
      ) => Promise<ProcessMediaResult | null>;
      /** G1: окно буфера альбома (default 1000мс). */
      albumBufferMs?: number;
      /**
       * G1: обработка альбома одним batch'ем (pipeline по каждому файлу,
       * вернуть суммарный OCR-текст). Агент вызывается максимум один раз.
       */
      processMediaAlbum?: (
        batch: import("./media-group-buffer.js").AlbumBatch,
        ctx: {
          chatId: string;
          userId: string;
          threadId?: string;
          allowed: boolean;
          archive: boolean;
          suppressReply: boolean;
          rulesContext: string;
        },
      ) => Promise<ProcessMediaResult | null>;
      /** G6: /pin (reply) — handler сам проверяет права и пинит. */
      pinHandler?: (
        ctx: { chatId: string; userId: string; messageId?: number },
      ) => Promise<string>;
      /** G11: /status — расширенный вывод для admin (метрики). */
      statusHandler?: (userId: string) => string | Promise<string>;
      /** SYSTEM UPDATE: /update — handler сам проверяет private+owner. */
      updateCommandHandler?: (userId: string, chatType: string) => string | Promise<string>;
      /** G4: deep link bot username для onboarding-подсказки. */
      botUsername?: string;
      /** Архивариус: сохранить текст/медиа в chat_archive (тихо, без ack). */
      archiveHandler?: (
        msg: TgMessage,
        ctx: {
          chatId: string;
          userId: string;
          kind: "text" | "photo" | "document" | "voice" | "video" | "video_note" | "audio";
        },
      ) => Promise<{ stored: boolean; notify?: string }>;
      /** Group Runtime Contract: единая подготовка хода (configured → rules → prefilter). */
      prepareTurn?: (input: import("./group-runtime.js").PrepareTurnInput) => import("./group-runtime.js").PrepareTurnResult;
      /** Typing heartbeat: шлёт sendChatAction(typing) каждые ~4с, пока идёт ответ. */
      sendChatAction?: (
        chatId: number,
        action: "typing",
        extra?: { messageThreadId?: number },
      ) => Promise<unknown>;
      /** Интервал пульса typing (тесты). Default 4000мс. */
      typingIntervalMs?: number;
      /** PROMPT 10: метрики (agent invocations/denied). */
      onMetric?: (name: string, n?: number) => void;
      /** C3: timeout agent turn (default 90s; heavy media/report — 180s). */
      agentTurnTimeoutMs?: number;
      agentTurnHeavyTimeoutMs?: number;
    },
  ) {
    const rawAgent = agent;
    this.agent = async (input) => {
      this.options?.onMetric?.("telegram_agent_invocations");
      return rawAgent(input);
    };
  }

  /**
   * C3/C4: вызов агента с wall-clock timeout. Timeout/ошибка → короткий
   * fallback-текст (одно сообщение); typing heartbeat останавливает вызывающий
   * в finally. Пустой ответ без файла → «Пустой ответ…» (§4).
   */
  private async runAgent(
    input: Parameters<GrishaAgent>[0],
    heavy: boolean,
  ): Promise<GrishaAgentReply> {
    const ms = heavy
      ? (this.options?.agentTurnHeavyTimeoutMs ?? TURN_HEAVY_MS)
      : (this.options?.agentTurnTimeoutMs ?? TURN_MS);
    try {
      const reply = await withTurnTimeout(ms, () => this.agent(input));
      if (!reply.text?.trim() && !reply.filePath && !reply.attachmentOnly) {
        return { ...reply, text: EMPTY_REPLY_MESSAGE };
      }
      return reply;
    } catch (err: unknown) {
      if (err instanceof TurnTimeoutError) {
        return { text: TURN_TIMEOUT_MESSAGE };
      }
      this.options?.onMetric?.("telegram_agent_error");
      return { text: TURN_ERROR_MESSAGE };
    }
  }

  /** Send a reply with all attached extras (file, caption, buttons). */
  private sendReply(chatId: number, reply: GrishaAgentReply, threadId?: string): Promise<void> {
    // R3: «только файл» — ровно один outbound: документ без текста/подписи/кнопок.
    if (reply.attachmentOnly && reply.filePath) {
      return this.sender(chatId, "", reply.filePath, { threadId });
    }
    return this.sender(chatId, reply.text, reply.filePath, {
      inlineButtons: reply.inlineButtons,
      documentCaption: reply.documentCaption,
      threadId,
    });
  }
  private makeSender(threadId?: string): TelegramReplySender {
    return (chatId, text, filePath, extra) =>
      this.sender(chatId, text, filePath, { ...extra, threadId });
  }

  /**
   * Typing heartbeat для разрешённого хода (только после allow, не при silent).
   * Форум — тот же message_thread_id, что у входящего сообщения.
   */
  private startHeartbeat(
    chatId: number,
    msg: TgMessage,
  ): import("./typing-heartbeat.js").TypingHeartbeatHandle | null {
    if (!this.options?.sendChatAction) return null;
    return startTypingHeartbeat(chatId, msg.threadId, {
      sendChatAction: (id, action, extra) => this.options!.sendChatAction!(id, action, extra),
      intervalMs: this.options.typingIntervalMs,
    });
  }

  private isProcessable(text: string, userId: number, chatId: number, msg: TgMessage, chatType: string): boolean {
    return this.evaluateInput(text, userId, chatId, msg, chatType).process;
  }

  /** Полная форма решения Layer-1: process + подавление ответа + архив + rulesContext. */
  private evaluateInput(
    text: string,
    userId: number,
    chatId: number,
    msg: TgMessage,
    chatType: string,
  ): { process: boolean; suppressReply: boolean; archive: boolean; rulesContext: string } {
    const isGroup = chatType === "group" || chatType === "supergroup";
    const isChannel = chatType === "channel";
    const isManaged = isGroup || isChannel;
    const prepareTurn = this.options?.prepareTurn;
    if (prepareTurn) {
      // Group Runtime Contract: единые шаги configured → rules → prefilter (R-GR-1/3/4).
      const result = prepareTurn({
        chatId: String(chatId),
        userId: String(userId),
        threadId: msg.threadId,
        chatType,
        isGroup,
        isChannel,
        text,
        botMentioned: msg.botMentioned,
        repliedToBot: msg.repliedToBot,
        startsWithOtherMention: msg.startsWithOtherMention,
        fromIsBot: msg.fromIsBot,
        isService: msg.isService,
        groupConfigured: isManaged ? (msg.groupConfigured ?? false) : undefined,
        caption: msg.caption,
        messageId: msg.messageId,
      });
      return {
        process: result.process,
        suppressReply: result.suppressReply,
        archive: result.archive,
        rulesContext: result.process ? result.rulesContext : "",
      };
    }

    // Fallback: legacy prefilter (boolean | outcome).
    const prefilter = this.options?.prefilter;
    if (!prefilter) return { process: true, suppressReply: false, archive: false, rulesContext: "" };
    const result = prefilter({
      chatId: String(chatId),
      fromUserId: String(userId),
      text,
      isGroup,
      isChannel,
      fromIsBot: msg.fromIsBot,
      isService: msg.isService,
      botMentioned: msg.botMentioned,
      repliedToBot: msg.repliedToBot,
      startsWithOtherMention: msg.startsWithOtherMention,
      // R1: pending (group/supergroup/channel) → false (silent). private → undefined.
      groupConfigured: isManaged ? (msg.groupConfigured ?? false) : undefined,
    });
    if (typeof result === "boolean") {
      return { process: result, suppressReply: false, archive: false, rulesContext: "" };
    }
    return {
      process: result.process !== false,
      suppressReply: result.suppressReply === true,
      archive: result.archive === true,
      rulesContext: "",
    };
  }

  isAllowed(userId: number): boolean {
    if (this.allowedUserIds.length === 0) return false;
    return this.allowedUserIds.includes(userId);
  }

  async handleUpdate(update: TgUpdate): Promise<{ handled: boolean; reason?: string }> {
    const msg = update.message;
    if (!msg?.chat) return { handled: false, reason: "no-message" };
    // Безопасный sender (PROMPT 02): from может отсутствовать (channel_post),
    // тогда отправитель — sender_chat (не приравнивается к user-авторизации).
    const senderUserId = msg.from?.id;
    const senderChatId = msg.senderChat?.id;
    if (senderUserId === undefined && senderChatId === undefined) {
      return { handled: false, reason: "no-user" };
    }
    const userId = senderUserId ?? senderChatId!;
    const hasRealUser = senderUserId !== undefined;

    const chatId = msg.chat.id;
    const chatType = msg.chat.type ?? "private";
    const isChannel = chatType === "channel";
    // P03: анонимный админ группы — Telegram шлёт служебный from
    // (GroupAnonymousBot, 1087968824) и sender_chat = сама группа. Такой
    // «пользователь» не должен объединять сессии разных людей и фальшиво
    // атрибутироваться в архиве: сессия — групповая (tg:anon:{chat}), а
    // msg.from стрипаем → архив пишет from_user_id = NULL (не фейковый id).
    const isAnonymousAdmin = this.isAnonymousMessage(msg, chatId);
    const sessionUserId = isAnonymousAdmin ? "anon" : userId;
    if (isAnonymousAdmin) msg.from = undefined;
    const text = msg.text ?? "";
    // Все ответы этого апдейта уходят в тему входящего сообщения.
    const send = this.makeSender(msg.threadId);

    if (hasRealUser) {
    if (text === "/start" || text.startsWith("/start ") || text.startsWith("/start@")) {
      // G4: deep link payload — /start setup_-100123 (или /start@Bot setup_...).
      const payload = text
        .replace(/^\/start(?:@\w+)?\s*/, "")
        .trim();
      if (payload.startsWith("setup_")) {
        const setupChatId = payload.slice("setup_".length).split("_")[0];
        if (chatType !== "private") {
          await send(
            chatId,
            `Настройка — только в личных сообщениях с ботом. Откройте DM и отправьте /start setup_${setupChatId}`,
          );
          return { handled: true };
        }
        const handler = this.options?.setupCommandHandler;
        if (handler) {
          const reply = await handler(
            setupChatId,
            { chatId: String(chatId), userId: String(userId), isPrivate: true },
            send,
          );
          await send(chatId, reply);
        }
        return { handled: true };
      }
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
        userId: sessionUserId,
        chatId,
        threadId: msg.threadId,
      });
      await this.options?.resetHandler?.(sessionKey, userId, String(chatId));
      await send(chatId, "Новая сессия начата.");
      return { handled: true };
    }
    if (text === "/status") {
      // G11: admin видит метрики; остальным — короткий статус.
      const statusHandler = this.options?.statusHandler;
      const reply = statusHandler
        ? await statusHandler(String(userId))
        : "Гриша работает.";
      await send(chatId, reply);
      return { handled: true };
    }
    // SYSTEM UPDATE: /update — только личка; owner-проверка внутри handler'а.
    if (text === "/update" || text.startsWith("/update ")) {
      const handler = this.options?.updateCommandHandler;
      if (!handler) {
        await send(chatId, "Обновление недоступно.");
        return { handled: true };
      }
      const reply = await handler(String(userId), chatType);
      await send(chatId, reply);
      return { handled: true };
    }
    // G6: /pin — закрепить сообщение, на которое сделан reply.
    if (text === "/pin" || text.startsWith("/pin ")) {
      const handler = this.options?.pinHandler;
      if (!handler) {
        await send(chatId, "Закрепление недоступно.");
        return { handled: true };
      }
      const reply = await handler({
        chatId: String(chatId),
        userId: String(userId),
        messageId: msg.replyTo?.messageId,
      });
      await send(chatId, reply);
      return { handled: true };
    }
    if (text.startsWith("/rules")) {
      const handler = this.options?.rulesHandler;
      if (handler) {
        const args = text.slice("/rules".length).trim();
        const reply = await handler(
          args,
          { chatId: String(chatId), userId: String(userId), chatType },
          {
            getChatMember: this.options.rulesGetChatMember
              ? (c, u) => this.options!.rulesGetChatMember!(c, u)
              : undefined,
          },
        );
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
    } // hasRealUser (команды/custom-текст — только от реальных пользователей)

    // G1: альбом (media_group_id) — батчем, максимум один ход агента.
    if (msg.mediaGroupId && this.options?.processMediaAlbum) {
      const item = albumItemOf(msg);
      if (!item) return { handled: true, reason: "album-buffered" };
      if (!this.albumBuffer) {
        this.albumBuffer = new MediaGroupBuffer(
          this.options.albumBufferMs ?? 1000,
          (batch) => this.flushAlbum(batch),
        );
      }
      if (!this.albumGates.has(msg.mediaGroupId)) {
        const placeholder = msg.caption ? `[альбом] ${msg.caption}` : "[альбом фото/файлов]";
        const gate = this.evaluateInput(placeholder, userId, chatId, msg, chatType);
        this.albumGates.set(msg.mediaGroupId, {
          gate,
          chatId,
          userId,
          chatType,
          send,
          msg,
        });
      }
      this.albumBuffer.add(msg.mediaGroupId, item);
      return { handled: true, reason: "album-buffered" };
    }

    if (msg.video?.file_id) {
      return this.handleMedia(msg, chatId, userId, chatType, send, "video");
    }
    if (msg.videoNote?.file_id) {
      return this.handleMedia(msg, chatId, userId, chatType, send, "video_note");
    }
    if (msg.audio?.file_id) {
      return this.handleMedia(msg, chatId, userId, chatType, send, "audio");
    }

    if (msg.voice) {
      // D3: голос транскрибируется ДО агента (STT pipeline), агенту идёт текст.
      const fileId = msg.voice.file_id;
      if (!fileId) return { handled: false, reason: "empty" };

      // PROMPT 04: единый медиа-конвейер (STT+архив по policy) при наличии hook.
      const isManagedChat = chatType === "group" || chatType === "supergroup" || chatType === "channel";
      const pending = isManagedChat && msg.groupConfigured === false;
      if (this.options?.processMedia && !pending) {
        return this.handleMedia(msg, chatId, userId, chatType, send, "voice");
      }

      // Legacy (без processMedia): STT → агент с транскриптом.
      const placeholder = msg.caption ?? "voice";
      const gate1 = this.evaluateInput(placeholder, userId, chatId, msg, chatType);
      if (!gate1.process) {
        return { handled: true, reason: "blocked-by-rules" };
      }
      // Agent-path ACL ПОСЛЕ policy (PROMPT 03); channel/sender_chat — agent denied.
      const acl = await this.checkAgentAcl({ userId, chatId, chatType, hasRealUser, send });
      if (!acl.allowed) return { handled: acl.handled, reason: acl.reason };
      this.options?.beforeAgent?.(chatId);
      // Heartbeat на время STT И агента; finally гарантирует остановку.
      const hb = this.startHeartbeat(chatId, msg);
      try {
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
        const gate2 = this.evaluateInput(text2, userId, chatId, msg, chatType);
        if (!gate2.process) {
          return { handled: true, reason: "blocked-by-rules" };
        }

        const response = await this.runAgent({
          message: text2,
          userId,
          platform: "telegram",
          sessionKey: buildTelegramSessionKey({
            userId: sessionUserId,
            chatId,
            threadId: msg.threadId,
          }),
          chatId: String(chatId),
          threadId: msg.threadId,
          rulesContext: gate2.rulesContext || undefined,
        }, true);
        if (gate2.suppressReply) return { handled: true, reason: "archived-silent" };
        await this.sendReply(chatId, response, msg.threadId);
        return { handled: true };
      } finally {
        await hb?.stop();
      }
    }
    if (msg.photo && msg.photo.length > 0) {
      return this.handleMedia(msg, chatId, userId, chatType, send, "photo");
    }
    if (msg.document?.file_id) {
      return this.handleMedia(msg, chatId, userId, chatType, send, "document");
    }
    if (msg.contact) {
      // Контакт уходит агенту как текст: агент сам решит, вызвать ли
      // contact_upsert (crm) через обычный tool-цикл — approval/rules-логику
      // не обходим. Реакция 👍 — тривиальное подтверждение приёма на исходном
      // сообщении (содержательный ответ всё равно приходит текстом от агента).
      const message = `Пользователь поделился контактом.\nИмя: ${msg.contact.first_name ?? ""} ${msg.contact.last_name ?? ""}\nТелефон: ${msg.contact.phone_number ?? "не указан"}`;
      const gate = this.evaluateInput(message, userId, chatId, msg, chatType);
      if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
      const acl = await this.checkAgentAcl({ userId, chatId, chatType, hasRealUser, send });
      if (!acl.allowed) return { handled: acl.handled, reason: acl.reason };
      if (msg.messageId !== undefined) this.options?.react?.(chatId, msg.messageId, "👍");
      this.options?.beforeAgent?.(chatId);
      const hb = this.startHeartbeat(chatId, msg);
      try {
        const response = await this.runAgent({
          message,
          userId,
          platform: "telegram",
          sessionKey: buildTelegramSessionKey({ userId: sessionUserId, chatId, threadId: msg.threadId }),
          chatId: String(chatId),
          threadId: msg.threadId,
          rulesContext: gate.rulesContext || undefined,
        }, false);
        if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
        await this.sendReply(chatId, response, msg.threadId);
        return { handled: true };
      } finally {
        await hb?.stop();
      }
    }
    if (msg.location) {
      // Геолокация — тот же путь через агента: он сам решит, вызывать ли
      // travel_item_add (travel) или ответить контекстно.
      const message = `Пользователь поделился геолокацией: ${msg.location.latitude ?? "?"}, ${msg.location.longitude ?? "?"}`;
      const gate = this.evaluateInput(message, userId, chatId, msg, chatType);
      if (!gate.process) return { handled: true, reason: "blocked-by-rules" };
      const acl = await this.checkAgentAcl({ userId, chatId, chatType, hasRealUser, send });
      if (!acl.allowed) return { handled: acl.handled, reason: acl.reason };
      this.options?.beforeAgent?.(chatId);
      const hb = this.startHeartbeat(chatId, msg);
      try {
        const response = await this.runAgent({
          message,
          userId,
          platform: "telegram",
          sessionKey: buildTelegramSessionKey({ userId: sessionUserId, chatId, threadId: msg.threadId }),
          chatId: String(chatId),
          threadId: msg.threadId,
          rulesContext: gate.rulesContext || undefined,
        }, false);
        if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
        await this.sendReply(chatId, response, msg.threadId);
        return { handled: true };
      } finally {
        await hb?.stop();
      }
    }
    if (!text) return { handled: false, reason: "empty" };

    const gate = this.evaluateInput(text, userId, chatId, msg, chatType);

    // L1: listen_only без обращения — агент заблокирован; текст всё равно тихо
    // архивируется (если archive=true), индикатор «печатает» не включается.
    // Архив решается ПО policy ДО agent ACL (PROMPT 03).
    if (gate.archive) {
      await this.archiveQuietly(msg, chatId, userId, "text", send);
      if (!gate.process) return { handled: true, reason: "archived-silent" };
    } else if (!gate.process) {
      return { handled: true, reason: "blocked-by-rules" };
    }

    // Agent path — только после archive-решения и только для реальных users.
    const acl = await this.checkAgentAcl({ userId, chatId, chatType, hasRealUser, send });
    if (!acl.allowed) return { handled: acl.handled, reason: acl.reason };

    this.options?.beforeAgent?.(chatId);
    // Heartbeat только когда пользователь получит ответ (не silent-archive).
    const hb = !gate.suppressReply ? this.startHeartbeat(chatId, msg) : null;
    try {
      const response = await this.runAgent({
        message: withReplyContext(text, msg),
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({ userId: sessionUserId, chatId, threadId: msg.threadId }),
        chatId: String(chatId),
        threadId: msg.threadId,
        rulesContext: gate.rulesContext || undefined,
      }, false);
      if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    } finally {
      await hb?.stop();
    }
  }

  /**
   * P03: анонимный админ группы — Telegram шлёт служебный from
   * (GroupAnonymousBot, 1087968824) и sender_chat = сама группа. LIVE-UNVERIFIED.
   */
  private isAnonymousMessage(msg: TgMessage, chatId: number): boolean {
    const senderUserId = msg.from?.id;
    return (
      (msg.chat?.type ?? "private") === "supergroup" &&
      (senderUserId === TELEGRAM_ANONYMOUS_ADMIN_ID ||
        (senderUserId !== undefined &&
          msg.senderChat?.id !== undefined &&
          msg.senderChat.id === chatId))
    );
  }

  /**
   * Agent-path ACL (PROMPT 03): вызывается ПОСЛЕ archive/медиа-решения и ДО
   * агента. Archive по chat policy разрешён и без agent ACL (listener).
   * Канал/sender_chat (без from): user-ACL неприменим → agent denied.
   */
  private async checkAgentAcl(opts: {
    userId: number;
    chatId: number;
    chatType: string;
    hasRealUser: boolean;
    send: TelegramReplySender;
  }): Promise<{ allowed: boolean; reason: string; handled: boolean }> {
    if (!opts.hasRealUser) {
      this.options?.onMetric?.("telegram_agent_denied");
      return { allowed: false, reason: "channel-no-user", handled: true };
    }

    // A1–A4: membership-ACL (предпочтительный путь).
    if (this.options?.telegramAccess) {
      const res = await resolveTelegramAccess(
        {
          userId: opts.userId,
          chatId: opts.chatId,
          chatType: opts.chatType,
          hasRealUser: opts.hasRealUser,
        },
        this.options.telegramAccess,
      );
      if (res.allowed) return { allowed: true, reason: "ok", handled: true };
      this.options?.onMetric?.("telegram_agent_denied");
      // A2: private → короткий отказ (если не ACL_DENY_REPLY=0);
      // группа — молча. LLM не вызывается.
      if (opts.chatType === "private" && process.env.ACL_DENY_REPLY !== "0") {
        await opts.send(opts.chatId, "Нет доступа.");
      }
      return { allowed: false, reason: res.reason, handled: true };
    }

    // FR-6: нет telegramAccess — legacy aclCheck.
    if (this.options?.aclCheck) {
      const allowed = await this.options.aclCheck(String(opts.userId), String(opts.chatId));
      if (!allowed) {
        this.options?.onMetric?.("telegram_agent_denied");
        // Политика v1: private → короткий отказ (если не ACL_DENY_REPLY=0);
        // группа — молча. LLM не вызывается.
        if (opts.chatType === "private" && process.env.ACL_DENY_REPLY !== "0") {
          await opts.send(opts.chatId, "Нет доступа.");
        }
        return { allowed: false, reason: "acl-denied", handled: true };
      }
      return { allowed: true, reason: "ok", handled: true };
    }
    if (!this.isAllowed(opts.userId)) {
      this.options?.onMetric?.("telegram_agent_denied");
      // Legacy-whitelist: handled=false (полностью игнорируем, как раньше).
      return { allowed: false, reason: "not-allowed", handled: false };
    }
    return { allowed: true, reason: "ok", handled: true };
  }

  /** G1: флаш альбома — pipeline по файлам, максимум один вызов агента. */
  private async flushAlbum(batch: AlbumBatch): Promise<void> {
    const ctx = this.albumGates.get(batch.groupId);
    this.albumGates.delete(batch.groupId);
    if (!ctx) return;
    const { gate, chatId, userId, chatType, send, msg } = ctx;

    const media = await this.options?.processMediaAlbum?.(batch, {
      chatId: String(chatId),
      userId: String(userId),
      threadId: msg.threadId,
      allowed: gate.process,
      archive: gate.archive,
      suppressReply: gate.suppressReply,
      rulesContext: gate.rulesContext,
    });
    if (!gate.process) return; // слушатель: обработано фоном, агента нет

    const acl = await this.checkAgentAcl({
      userId,
      chatId,
      chatType,
      hasRealUser: msg.from?.id !== undefined,
      send,
    });
    if (!acl.allowed) return;

    this.options?.beforeAgent?.(chatId);
    const hb = !gate.suppressReply ? this.startHeartbeat(chatId, msg) : null;
    try {
      const agentMessage = buildAlbumAgentMessage(batch, media);
      const response = await this.runAgent({
        message: agentMessage,
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({
          userId: this.isAnonymousMessage(msg, chatId) ? "anon" : userId,
          chatId,
          threadId: msg.threadId,
        }),
        chatId: String(chatId),
        threadId: msg.threadId,
        rulesContext: gate.rulesContext || undefined,
      }, true);
      if (gate.suppressReply) return;
      await this.sendReply(chatId, response, msg.threadId);
    } finally {
      await hb?.stop();
    }
  }

  /**
   * Единая ветка photo/document (B2/B4): сначала download+OCR (или архив),
   * потом агент с распознанным текстом — не с голым file_id.
   *
   * Матрица (спека «Group photos»):
   * - pending-группа: тишина, без OCR и без агента (R-GR-1);
   * - listen_only без @: OCR+archive+expense фоном, ответа нет;
   * - любой allowed-ход с медиа: агент получает OCR-текст в том же ходе.
   */
  private async handleMedia(
    msg: TgMessage,
    chatId: number,
    userId: number,
    chatType: string,
    send: TelegramReplySender,
    kind: "photo" | "document" | "voice" | "video" | "video_note" | "audio",
  ): Promise<{ handled: boolean; reason?: string }> {
    const fileId =
      kind === "photo"
        ? lastPhotoFileId(msg.photo ?? [])
        : kind === "voice"
          ? msg.voice?.file_id ?? "unknown"
          : kind === "video"
            ? msg.video?.file_id ?? "unknown"
            : kind === "video_note"
              ? msg.videoNote?.file_id ?? "unknown"
              : kind === "audio"
                ? msg.audio?.file_id ?? "unknown"
                : msg.document?.file_id ?? "unknown";
    const base = mediaBaseText(kind);
    // Вход prefilter'а — прежний (file_id-сообщение): решения правил не меняются.
    const message = `${base}\nfile_id: ${fileId}\nПодпись: ${msg.caption ?? "нет"}`;
    const gate = this.evaluateInput(message, userId, chatId, msg, chatType);

    const isGroup = chatType === "group" || chatType === "supergroup";
    const isManaged = isGroup || chatType === "channel";
    // R1: pending (group/supergroup/channel) → тишина, без OCR и без агента.
    const pendingManaged = isManaged && msg.groupConfigured === false;
    const processMedia = pendingManaged ? undefined : this.options?.processMedia;

    // Heartbeat на время OCR И агента (только когда будет ответ пользователю).
    const hb = gate.process && !gate.suppressReply ? this.startHeartbeat(chatId, msg) : null;
    try {
      let media: ProcessMediaResult | null = null;
      if (processMedia) {
        media = await processMedia(msg, {
          chatId: String(chatId),
          userId: String(userId),
          kind,
          allowed: gate.process,
          archive: gate.archive,
        });
        if (media?.notify) {
          await send(chatId, media.notify, undefined, { threadId: msg.threadId });
        }
      } else {
        // Legacy (без processMedia — старые тесты/контроллеры): тихий архив
        // через archiveHandler; инжест с ack — как раньше.
        if (gate.archive) {
          await this.archiveQuietly(msg, chatId, userId, kind, send);
        } else {
          const ingest = pendingManaged ? undefined : this.options?.documentIngest;
          if (ingest) {
            const ingested = await ingest(msg, { chatId: String(chatId), userId: String(userId) });
            if (ingested?.ack) {
              await send(chatId, ingested.ack);
              return { handled: true, reason: "document-ingested" };
            }
          }
        }
      }

      if (!gate.process) {
        // listen_only без @mention: OCR/архив уже сделан, ответа нет.
        return { handled: true, reason: gate.archive ? "archived-silent" : "blocked-by-rules" };
      }

      // Agent path — только после media-решения; канал/sender_chat — denied.
      const acl = await this.checkAgentAcl({
        userId,
        chatId,
        chatType,
        hasRealUser: msg.from?.id !== undefined,
        send,
      });
      if (!acl.allowed) return { handled: acl.handled, reason: acl.reason };

      this.options?.beforeAgent?.(chatId);
      const agentMessage = processMedia
        ? withReplyContext(buildMediaAgentMessage(kind, msg, fileId, media), msg)
        : message;
      const response = await this.runAgent({
        message: agentMessage,
        userId,
        platform: "telegram",
        sessionKey: buildTelegramSessionKey({
          userId: this.isAnonymousMessage(msg, chatId) ? "anon" : userId,
          chatId,
          threadId: msg.threadId,
        }),
        chatId: String(chatId),
        threadId: msg.threadId,
        rulesContext: gate.rulesContext || undefined,
      }, true);
      if (gate.suppressReply) return { handled: true, reason: "archived-silent" };
      await this.sendReply(chatId, response, msg.threadId);
      return { handled: true };
    } finally {
      await hb?.stop();
    }
  }

  /**
   * Тихое сохранение в архив: ошибки архива не роняют обработку.
   * R-GR-8: notify от handler'а (плохой OCR) отправляется только если
   * policy-флаг чата это разрешил — решение принимает сам handler.
   */
  private async archiveQuietly(
    msg: TgMessage,
    chatId: number,
    userId: number,
    kind: "text" | "photo" | "document" | "voice" | "video" | "video_note" | "audio",
    send: TelegramReplySender,
  ): Promise<void> {
    try {
      const result = await this.options?.archiveHandler?.(msg, {
        chatId: String(chatId),
        userId: String(userId),
        kind,
      });
      if (result?.notify) {
        await send(chatId, result.notify, undefined, { threadId: msg.threadId });
      }
    } catch (err: unknown) {
      console.error(
        "[telegram-bot] archive failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
