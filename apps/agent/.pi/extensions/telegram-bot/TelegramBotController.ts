import {
  TelegramBridge,
  formatTelegramHtml,
  type GrishaAgent,
  type RulePreFilter,
  type TelegramApprovalHandler,
  type TelegramReplySender,
  type TelegramResetHandler,
  type TelegramRulesHandler,
  type TelegramSendExtra,
  type TgMessage,
  type TgUpdate,
} from "./TelegramBridge.js";
import type { InlineButton } from "../../../src/utils/telegram/session-files.js";
import fs from "node:fs";
import { normalizeThreadId } from "./threads.js";
import { collectMentionFlags } from "./mentions.js";
import {
  computeSendDelayMs,
  parseTelegramError,
  shouldRetrySend,
  type ParsedTelegramError,
} from "./telegram-errors.js";
import { ChatSendQueue } from "./send-queue.js";
import { TELEGRAM_MAX_FILE_BYTES } from "./file-send.js";
import {
  setTelegramFileSender,
  type TelegramFileSendInput,
  type TelegramFileSendResult,
} from "./file-send-bridge.js";

/** Minimal callback-query context surface (grammy `callback_query:data`). */
export interface TelegramCallbackQueryContext {
  from?: { id?: number };
  data?: string;
  message?: { chat?: { id?: number }; message_id?: number; text?: string };
  answerCallbackQuery(text?: string, extra?: { showAlert?: boolean }): Promise<unknown>;
  editMessageText(text: string, extra?: { removeKeyboard?: boolean }): Promise<unknown>;
}

/** Событие my_chat_member (бота добавили/кикнули). */
export interface TelegramChatMemberEvent {
  oldStatus: string;
  newStatus: string;
  chat: { id: number; type?: string; title?: string };
  from: { id: number };
}

/** Minimal surface of a grammy Bot needed for long polling. */
export interface TelegramBotLike {
  on(
    filter: "message" | "callback_query:data" | "my_chat_member",
    handler: ((ctx: unknown) => unknown) | ((ctx: TelegramCallbackQueryContext) => unknown),
  ): void;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  api: {
    sendMessage(
      chatId: number,
      text: string,
      extra?: {
        parseMode?: "HTML";
        inlineButtons?: InlineButton[][];
        messageThreadId?: number;
      },
    ): Promise<unknown>;
    sendDocument(
      chatId: number,
      filePath: string,
      extra?: { caption?: string; messageThreadId?: number },
    ): Promise<unknown>;
    sendChatAction(chatId: number, action: "typing" | "upload_document"): Promise<unknown>;
    setMyCommands(commands: Array<{ command: string; description: string }>): Promise<unknown>;
    setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<unknown>;
    getChatMember(chatId: number, userId: number): Promise<{ status: string }>;
  };
}

export interface TelegramBotFactory {
  (token: string): TelegramBotLike;
}

/** Commands advertised to Telegram via setMyCommands — only real bridge commands. */
export const DEFAULT_TELEGRAM_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "start", description: "Приветствие" },
  { command: "new", description: "Начать новую сессию" },
  { command: "status", description: "Статус бота" },
  { command: "rules", description: "Управление правилами пользователя" },
  { command: "approve", description: "Одобрить запрос: /approve <id>" },
  { command: "deny", description: "Отклонить запрос: /deny <id>" },
];

export interface TelegramBotControllerOptions {
  prefilter?: RulePreFilter;
  rulesHandler?: TelegramRulesHandler;
  resetHandler?: TelegramResetHandler;
  /** Shared approve/deny logic (approval-gate) — used by both /approve|/deny text and callback buttons. */
  approvalHandler?: TelegramApprovalHandler;
  /** Early ACL-проверка (UsersService) — ДО prefilter и агента. */
  aclCheck?: (userId: string, chatId: string) => boolean | Promise<boolean>;
  /** Прямой handler /users ... (UsersService + canManage guard). */
  usersCommandHandler?: (
    args: string,
    ctx: { chatId: string; userId: string },
  ) => string | Promise<string>;
  /** Прямой handler /setup ... (DM-only, шлёт keyboard). */
  setupCommandHandler?: (
    args: string,
    ctx: { chatId: string; userId: string; isPrivate: boolean },
    send: TelegramReplySender,
    deps: {
      /** Проверка реального статуса actor в чате (getChatMember). */
      getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
    },
  ) => string | Promise<string>;
  /** D9: подсказка в /start про pending-группы. */
  pendingGroupsHint?: (userId: string) => string | Promise<string>;
  /** D3: STT-транскрипция голосового до агента. */
  transcribeVoice?: (
    fileId: string,
    meta: { chatId: string; userId: string },
  ) => Promise<string>;
  /** Перехват custom-текста онбординга в DM (true → не звать агента). */
  customSetupInterceptor?: (
    input: { userId: string; chatId: string; text: string; isPrivate: boolean },
    send: TelegramReplySender,
  ) => Promise<boolean>;
  /** Обработчик cs:-callbacks (чат-онбординг). */
  setupCallbackHandler?: (
    data: string,
    ctx: TelegramCallbackQueryContext,
    deps: {
      /** Проверка реального статуса actor в чате (getChatMember). */
      getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
    },
  ) => Promise<boolean>;
  /** Обработчик «бота добавили в чат» (онбординг). */
  chatMemberHandler?: (
    event: TelegramChatMemberEvent,
    deps: {
      sendMessage: (
        chatId: number,
        text: string,
        extra?: { parseMode?: "HTML"; inlineButtons?: InlineButton[][] },
      ) => Promise<unknown>;
    },
  ) => Promise<void>;
  /** Инжест чеков/накладных из photo/document сообщений. */
  documentIngest?: (
    msg: TgMessage,
    ctx: { chatId: string; userId: string },
  ) => Promise<{ ack?: string } | null>;
  /** Архивариус: сохранить текст/медиа в chat_archive (тихо, без ack). */
  archiveHandler?: (
    msg: TgMessage,
    ctx: { chatId: string; userId: string; kind: "text" | "photo" | "document" },
  ) => Promise<{ stored: boolean; notify?: string }>;
  /** Group Runtime Contract: единая подготовка хода (configured → rules → prefilter). */
  prepareTurn?: (
    input: import("./group-runtime.js").PrepareTurnInput,
  ) => import("./group-runtime.js").PrepareTurnResult;
  /** self-инфо бота (id/username) для расчёта mention/reply флагов. */
  getBotSelf?: () => { id: number; username?: string } | undefined;
  /** R1: false → pending-группа silent (ChatSetupService.isConfiguredSync). */
  getGroupConfigured?: (chatId: string) => boolean;
  /** Advertised bot commands (defaults to DEFAULT_TELEGRAM_COMMANDS). */
  commands?: Array<{ command: string; description: string }>;
  /** Send retry policy (injectable for tests). */
  sendRetry?: {
    maxAttempts?: number;
    /** Optional override; receives attempt + parsed error. */
    delayMs?: (attempt: number, parsed: ParsedTelegramError) => number;
  };
  /** Delay between long-polling reconnects. */
  reconnectDelayMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RECONNECT_DELAY_MS = 10_000;
const DEFAULT_SEND_MAX_ATTEMPTS = 5;

/** Telegram-лимит sendMessage: текст длиннее 4096 отклоняется API. */
export const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
/** Целевой размер чанка сырого текста — с запасом на HTML-теги после форматирования. */
export const SPLIT_TARGET_LENGTH = 4000;

/**
 * Разбивает СЫРОЙ (до formatTelegramHtml) текст на чанки по границам абзацев,
 * затем предложений. Критерий — длина УЖЕ ОТФОРМАТИРОВАННОГО кандидата ≤
 * Telegram-лимита, поэтому добавление тегов разметки не выталкивает чанк за
 * 4096. Слишком длинное предложение режется жёстко по `target` сырых символов
 * (патологический случай; в обычном тексте не встречается).
 */
export function splitTelegramText(text: string, target = SPLIT_TARGET_LENGTH): string[] {
  if (formatTelegramHtml(text).length <= MAX_TELEGRAM_MESSAGE_LENGTH) return [text];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= target) {
      units.push(paragraph);
      continue;
    }
    const sentences =
      paragraph.match(/[^.!?…]+[.!?…]+\s*|[^.!?…]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 0) ??
      [paragraph];
    for (const sentence of sentences) {
      if (formatTelegramHtml(sentence).length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
        units.push(sentence);
      } else {
        for (let i = 0; i < sentence.length; i += target) {
          units.push(sentence.slice(i, i + target));
        }
      }
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current.length === 0 ? unit : `${current}\n\n${unit}`;
    if (
      current.length === 0 ||
      formatTelegramHtml(candidate).length <= MAX_TELEGRAM_MESSAGE_LENGTH
    ) {
      current = candidate;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Owns a long-polling Telegram bot: wires incoming messages to the bridge,
 * starts/stops polling. The bot is created via an injected factory so the
 * lifecycle is unit-testable without a real token.
 *
 * Long polling runs in a reconnect loop: Telegram из РФ доступен нестабильно
 * (РКН блокирует IP), поэтому при сбое start() бот пересоздаётся и пробует
 * снова, а не сдаётся после первой ошибки. Отправка идёт с ретраями, потому
 * что grammy не ретраит HTTP 502 от прокси.
 */
export class TelegramBotController {
  private bot: TelegramBotLike | null = null;
  private running = false;
  /** Per-chat очередь исходящих sendMessage/sendDocument (не глобальная). */
  private readonly sendQueue = new ChatSendQueue();

  constructor(
    private readonly agent: GrishaAgent,
    private readonly allowedUserIds: number[],
    private readonly botFactory: TelegramBotFactory,
    private readonly options?: TelegramBotControllerOptions,
  ) {
    // Инструмент send_file в субсессиях шлёт файлы через ЭТОТ контроллер
    // (текущий bot instance + per-chat очередь + retry). Метод читает this.bot
    // в момент вызова, поэтому регистрация в конструкторе валидна при реконнектах.
    setTelegramFileSender((input) => this.sendFileToChat(input));
  }

  isRunning(): boolean {
    return this.running;
  }

  private sleep(ms: number): Promise<void> {
    if (this.options?.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  start(token: string): void {
    if (this.running) return;
    this.running = true;
    void this.pollLoop(token);
  }

  /**
   * Long-polling loop with automatic reconnect. Exits only when stop() is
   * called (running=false) — an error in bot.start() leads to a recreated bot
   * after a delay, never to a silently dead controller.
   */
  private async pollLoop(token: string): Promise<void> {
    while (this.running) {
      const bot = this.botFactory(token);
      this.bot = bot;

      const bridge = new TelegramBridge(
        this.allowedUserIds,
        this.agent,
        // Per-chat очередь: бурст в один chat_id сериализуется (меньше 429),
        // разные чаты не блокируют друг друга.
        async (chatId, text, filePath, extra) =>
          this.sendQueue.enqueue(chatId, () => this.sendReply(bot, chatId, text, filePath, extra)),
        {
          prefilter: this.options?.prefilter,
          rulesHandler: this.options?.rulesHandler,
          resetHandler: this.options?.resetHandler,
          approvalHandler: this.options?.approvalHandler,
          // Индикатор «печатает…» перед тем, как агент начнёт отвечать.
          beforeAgent: (chatId) => {
            void bot.api
              .sendChatAction(chatId, "typing")
              .catch((err: unknown) => console.error("[telegram-bot] sendChatAction failed:", err));
          },
          // Реакция на исходное сообщение — только тривиальные подтверждения
          // (например, 👍 на принятом контакте), не заменяет ответы агента.
          react: (chatId, messageId, emoji) => {
            void bot.api
              .setMessageReaction(chatId, messageId, emoji)
              .catch((err: unknown) => console.error("[telegram-bot] setMessageReaction failed:", err));
          },
          aclCheck: this.options?.aclCheck,
          usersCommandHandler: this.options?.usersCommandHandler,
          setupCommandHandler: this.options?.setupCommandHandler
            ? (args, ctx, send) => {
                const handler = this.options?.setupCommandHandler;
                if (!handler) return "Настройка временно недоступна.";
                return handler(args, ctx, send, {
                  getChatMember: (chatId, userId) => bot.api.getChatMember(chatId, userId),
                });
              }
            : undefined,
          pendingGroupsHint: this.options?.pendingGroupsHint,
          transcribeVoice: this.options?.transcribeVoice,
          customSetupInterceptor: this.options?.customSetupInterceptor,
          documentIngest: this.options?.documentIngest,
          archiveHandler: this.options?.archiveHandler,
          prepareTurn: this.options?.prepareTurn,
        },
      );

      bot.on("message", (ctx: unknown) => {
        const update = this.toTgUpdate(ctx);
        if (!update) return;
        const msg = update.message;
        // FR-6: сервисные сообщения (new_chat_members/left_chat_member,
        // new_chat_title, pinned_message и т.п.) — НЕ ввод для агента.
        if (msg?.isService) {
          console.log(
            `[telegram-bot] service message chat=${msg.chat?.id ?? "?"} ignored (not agent input)`,
          );
          return;
        }
        console.log(
          `[telegram-bot] incoming message from user=${msg?.from?.id ?? "?"} chat=${msg?.chat?.id ?? "?"} ` +
            `kind=${msg?.text ? "text" : msg?.photo?.length ? "photo" : msg?.document ? "document" : msg?.voice ? "voice" : msg?.contact ? "contact" : msg?.location ? "location" : "other"}`,
        );
        void bridge.handleUpdate(update).catch((err: unknown) => {
          console.error(
            "[telegram-bot] message handling failed:",
            err instanceof Error ? err.message : err,
          );
        });
      });

      bot.on("my_chat_member", (ctx: unknown) => {
        const event = this.toChatMemberEvent(ctx);
        if (!event) {
          console.log("[telegram-bot] my_chat_member: unparseable update (ignored)");
          return;
        }
        // FR-9: лог события ДО обработки (отладка онбординга без «вслепую»).
        console.log(
          `[telegram-bot] my_chat_member: old=${event.oldStatus} new=${event.newStatus} ` +
            `chat=${event.chat.id} actor=${event.from.id}`,
        );
        void (async () => {
          try {
            await this.options?.chatMemberHandler?.(event, {
              // Исходящий онбординг — тоже через per-chat очередь.
              sendMessage: (chatId, text, extra) =>
                this.sendQueue.enqueue(chatId, async () => {
                  await bot.api.sendMessage(chatId, text, {
                    parseMode: "HTML",
                    inlineButtons: extra?.inlineButtons,
                  });
                }),
            });
            console.log(`[telegram-bot] my_chat_member handled for chat ${event.chat.id}`);
          } catch (err: unknown) {
            console.error(
              "[telegram-bot] chat member handler failed:",
              err instanceof Error ? err.message : err,
            );
          }
        })();
      });

      bot.on("callback_query:data", (ctx: TelegramCallbackQueryContext) => {
        void this
          .handleCallbackQuery(ctx)
          .catch((err: unknown) => {
            console.error(
              "[telegram-bot] callback_query handling failed:",
              err instanceof Error ? err.message : err,
            );
          });
      });

      // Рекламируем реально существующие команды (меню в поле ввода Telegram).
      // Fire-and-forget: не задерживаем bot.start() (контракт start() синхронный).
      void bot.api
        .setMyCommands(this.options?.commands ?? DEFAULT_TELEGRAM_COMMANDS)
        .catch((err: unknown) => {
          console.error(
            "[telegram-bot] setMyCommands failed:",
            err instanceof Error ? err.message : err,
          );
        });

      try {
        console.log("[telegram-bot] long polling started");
        await bot.start();
        // bot.start() resolved — normal stop via stop().
        this.bot = null;
        return;
      } catch (err: unknown) {
        const reason =
          err instanceof Error
            ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ""}`
            : String(err);
        this.bot = null;
        if (!this.running) return;
        const delay = this.options?.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
        console.error(
          `[telegram-bot] long polling failed, recreating bot in ${delay}ms: ${reason}`,
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * Inline-кнопка «Одобрить/Отклонить»: разбор callbackData "approve:<id>"/"deny:<id>",
   * та же общая функция, что и у текстовых команд /approve//deny, затем
   * answerCallbackQuery + снятие клавиатуры с исходного сообщения.
   */
  private async handleCallbackQuery(ctx: TelegramCallbackQueryContext): Promise<void> {
    // Chat-setup (cs:...) — пермишены внутри обработчика (canManage/addedBy +
    // getChatMember), legacy-whitelist к ним не применяется.
    if ((ctx.data ?? "").startsWith("cs:") && this.options?.setupCallbackHandler) {
      const handled = await this.options.setupCallbackHandler(ctx.data as string, ctx, {
        getChatMember: (chatId, userId) => {
          const bot = this.bot;
          if (!bot) return Promise.reject(new Error("bot not running"));
          return bot.api.getChatMember(chatId, userId);
        },
      });
      if (handled) return;
    }
    const userId = ctx.from?.id;
    if (userId === undefined) {
      await ctx.answerCallbackQuery("Недоступно.").catch(() => undefined);
      return;
    }
    // D4: единый источник ACL — UsersService (aclCheck). allowedUserIds —
    // только legacy fallback, когда aclCheck не настроен.
    const callbackChatId = String(ctx.message?.chat?.id ?? userId);
    const allowed = this.options?.aclCheck
      ? await this.options.aclCheck(String(userId), callbackChatId)
      : this.allowedUserIds.includes(userId);
    if (!allowed) {
      await ctx.answerCallbackQuery("Недоступно.").catch(() => undefined);
      return;
    }
    const match = /^(approve|deny):(.+)$/.exec(ctx.data ?? "");
    if (!match || !this.options?.approvalHandler) {
      await ctx.answerCallbackQuery("Неизвестное действие.").catch(() => undefined);
      return;
    }
    const message = this.options.approvalHandler(match[1] as "approve" | "deny", match[2]);
    await ctx.answerCallbackQuery(message).catch(() => undefined);
    const original = ctx.message?.text?.trim() ?? "";
    await ctx
      .editMessageText(original ? `${original}\n\n${message}` : message, { removeKeyboard: true })
      .catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    const bot = this.bot;
    this.bot = null;
    if (bot) {
      try {
        await bot.stop();
      } catch (err: unknown) {
        console.error(
          "[telegram-bot] bot.stop() failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /**
   * Отправка с ретраями: до maxAttempts попыток с нарастающей паузой
   * (по умолчанию 3с × attempt). Возвращает true при успехе, false — после
   * исчерпания попыток (не бросает: сбой отправки не должен ронять polling).
   */
  private async sendWithRetry(
    fn: () => Promise<unknown>,
    label: string,
  ): Promise<boolean> {
    const maxAttempts = this.options?.sendRetry?.maxAttempts ?? DEFAULT_SEND_MAX_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fn();
        return true;
      } catch (err: unknown) {
        const parsed = parseTelegramError(err);

        if (!shouldRetrySend(parsed, attempt, maxAttempts)) {
          console.error(
            `[telegram-bot] ${label} non-retryable or exhausted:`,
            parsed.kind,
            parsed.description ?? (err instanceof Error ? err.message : err),
          );
          return false;
        }

        const delay =
          this.options?.sendRetry?.delayMs?.(attempt, parsed) ??
          computeSendDelayMs(parsed, attempt);

        console.error(
          `[telegram-bot] ${label} ${parsed.kind} (attempt ${attempt}/${maxAttempts}), ` +
            `waiting ${delay}ms` +
            (parsed.retryAfterSec != null ? ` (retry_after=${parsed.retryAfterSec}s)` : ""),
        );
        await this.sleep(delay);
      }
    }
    return false;
  }

  /**
   * Отправка ответа в чат: чанки (HTML с ретраями) + документ. Один чанк:
   * 1) HTML через sendWithRetry; 2) при неудаче — plain без parseMode тоже
   * через sendWithRetry (429 на plain не теряет сообщение). Невалидный HTML
   * (bad_request) не ретраится — сразу plain.
   */
  private async sendReply(
    bot: TelegramBotLike,
    chatId: number,
    text: string,
    filePath?: string,
    extra?: TelegramSendExtra,
  ): Promise<void> {
    const rawChunks = splitTelegramText(text);
    let textOk = true;
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkHtml = formatTelegramHtml(rawChunks[i]);
      const isLast = i === rawChunks.length - 1;
      let ok = await this.sendWithRetry(
        () =>
          bot.api.sendMessage(chatId, chunkHtml, {
            parseMode: "HTML",
            // Кнопки — только к последнему чанку, иначе продублируются в каждом.
            inlineButtons: isLast ? extra?.inlineButtons : undefined,
            // Ответ в тему форума (message_thread_id) из входящего сообщения.
            messageThreadId: extra?.threadId !== undefined ? Number(extra.threadId) : undefined,
          }),
        "sendMessage:html",
      );
      // D7 + спека Пакета A: HTML не ушёл → plain-фолбэк того же чанка
      // (с ретраями только для retry_after/retryable).
      if (!ok) {
        ok = await this.sendWithRetry(
          () =>
            bot.api.sendMessage(chatId, rawChunks[i], {
              inlineButtons: isLast ? extra?.inlineButtons : undefined,
              messageThreadId: extra?.threadId !== undefined ? Number(extra.threadId) : undefined,
            }),
          "sendMessage:plain",
        );
      }
      if (!ok) textOk = false;
    }
    let docOk = true;
    if (filePath) {
      // Индикатор загрузки документа перед отправкой файла.
      void bot.api
        .sendChatAction(chatId, "upload_document")
        .catch((err: unknown) => console.error("[telegram-bot] sendChatAction failed:", err));
      docOk = await this.sendWithRetry(
        () =>
          bot.api.sendDocument(chatId, filePath, {
            caption: extra?.documentCaption,
            // Форум: документ — в ту же тему, что и входящее сообщение.
            messageThreadId: extra?.threadId !== undefined ? Number(extra.threadId) : undefined,
          }),
        "sendDocument",
      );
    }
    if (textOk && docOk) {
      console.log(
        `[telegram-bot] reply sent to chat ${chatId}${filePath ? " (with document)" : ""}`,
      );
    } else {
      console.error(`[telegram-bot] reply to chat ${chatId} failed`);
    }
  }

  /**
   * Отправка файла по запросу инструмента send_file: текущий bot instance,
   * per-chat очередь + sendWithRetry (уважает retry_after/429). Форум —
   * message_thread_id из контекста сессии. Размер проверяется ДО очереди.
   */
  async sendFileToChat(input: TelegramFileSendInput): Promise<TelegramFileSendResult> {
    const bot = this.bot;
    if (!bot) return { ok: false, error: "Telegram-бот не запущен." };

    // Валидация на входе (инструмент тоже проверяет — защита в глубину).
    let sizeBytes: number;
    try {
      const stat = fs.statSync(input.filePath);
      if (!stat.isFile()) return { ok: false, error: "Это не файл." };
      sizeBytes = stat.size;
    } catch {
      return { ok: false, error: `Файл не найден: ${input.filePath}` };
    }
    if (sizeBytes > TELEGRAM_MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `Файл ${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ — больше лимита Telegram (50 МБ).`,
      };
    }

    let result: unknown;
    let ok = false;
    await this.sendQueue.enqueue(input.chatId, async () => {
      ok = await this.sendWithRetry(
        async () => {
          result = await bot.api.sendDocument(input.chatId, input.filePath, {
            caption: input.caption,
            messageThreadId: input.threadId,
          });
        },
        "sendDocument:send_file",
      );
    });

    if (!ok) {
      return { ok: false, error: "Не удалось отправить файл (лимиты/сеть Telegram)." };
    }
    const rec = (result ?? null) as {
      message_id?: number;
      document?: { file_id?: string };
    } | null;
    return {
      ok: true,
      fileId: rec?.document?.file_id,
      messageId: rec?.message_id,
    };
  }

  private toTgUpdate(ctx: unknown): TgUpdate | null {
    if (!ctx || typeof ctx !== "object") return null;
    const c = ctx as {
      update?: { update_id?: number };
      message?: {
        from?: { id?: number; first_name?: string; is_bot?: boolean };
        chat?: { id?: number; type?: string; is_forum?: boolean };
        message_id?: number;
        message_thread_id?: number;
        reply_to_message?: { from?: { id?: number }; message_thread_id?: number };
        text?: string;
        caption?: string;
        entities?: Array<{ type?: string; offset?: number; length?: number; user?: { id?: number } }>;
        caption_entities?: Array<{ type?: string; offset?: number; length?: number; user?: { id?: number } }>;
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
        new_chat_members?: unknown;
        left_chat_member?: unknown;
        new_chat_title?: unknown;
        new_chat_photo?: unknown;
        delete_chat_photo?: unknown;
        group_chat_created?: unknown;
        supergroup_chat_created?: unknown;
        channel_chat_created?: unknown;
        pinned_message?: unknown;
      };
    };
    const m = c.message;
    if (!m?.chat) return null;

    // Тема форума: из message_thread_id или fallback reply_to_message.
    const threadId = normalizeThreadId(
      m.message_thread_id ?? m.reply_to_message?.message_thread_id,
    );
    const isForum = m.chat.is_forum === true;
    // R1: для группы всегда boolean (pending → false → silent); private — undefined.
    const chatType = m.chat.type ?? "private";
    const isGroup = chatType === "group" || chatType === "supergroup";
    const groupConfigured = isGroup
      ? (this.options?.getGroupConfigured?.(String(m.chat.id ?? 0)) ?? false)
      : undefined;

    // ── Pre-filter флаги (structured rules §9): mention/reply/bot/service. ──
    const self = this.options?.getBotSelf?.();
    const textOrCaption = m.text ?? m.caption ?? "";
    // D1: entities (текст) + caption_entities (подпись к фото/документу).
    const fromText = collectMentionFlags(textOrCaption, m.entities ?? [], self);
    const fromCaption = collectMentionFlags(m.caption ?? "", m.caption_entities ?? [], self);
    const botMentioned =
      fromText.botMentioned || fromCaption.botMentioned ? true : undefined;
    const startsWithOtherMention =
      fromText.startsWithOtherMention || fromCaption.startsWithOtherMention ? true : undefined;
    const replyFromId = m.reply_to_message?.from?.id;
    const repliedToBot =
      self && replyFromId !== undefined ? replyFromId === self.id : undefined;

    const serviceFields = [
      m.new_chat_members,
      m.left_chat_member,
      m.new_chat_title,
      m.new_chat_photo,
      m.delete_chat_photo,
      m.group_chat_created,
      m.supergroup_chat_created,
      m.channel_chat_created,
      m.pinned_message,
    ];
    const isService = serviceFields.some((f) => f !== undefined);

    return {
      updateId: c.update?.update_id ?? 0,
      message: {
        from: m.from ? { id: m.from.id ?? 0, firstName: m.from.first_name } : undefined,
        chat: { id: m.chat.id ?? 0, type: m.chat.type },
        messageId: m.message_id,
        threadId,
        isForum,
        groupConfigured,
        text: m.text,
        caption: m.caption,
        voice: m.voice as { file_id?: string } | undefined,
        document: m.document,
        photo: m.photo,
        contact: m.contact,
        location: m.location,
        fromIsBot: m.from?.is_bot === true,
        isService,
        botMentioned,
        repliedToBot,
        startsWithOtherMention,
      },
    };
  }

  private toChatMemberEvent(ctx: unknown): TelegramChatMemberEvent | null {
    if (!ctx || typeof ctx !== "object") return null;
    const c = ctx as {
      // P0-фикс: grammy отдаёт событие через getter myChatMember (camelCase),
      // а плоское snake_case ctx.my_chat_member отсутствует — всегда undefined.
      myChatMember?: {
        old_chat_member?: { status?: string };
        new_chat_member?: { status?: string };
      };
      // Сырой update (совместимость с фейками и прямым прогоном update-объекта).
      my_chat_member?: {
        old_chat_member?: { status?: string };
        new_chat_member?: { status?: string };
      };
      update?: {
        my_chat_member?: {
          old_chat_member?: { status?: string };
          new_chat_member?: { status?: string };
        };
      };
      chat?: { id?: number; type?: string; title?: string };
      from?: { id?: number };
    };
    const cu = c.myChatMember ?? c.my_chat_member ?? c.update?.my_chat_member;
    if (!cu) return null;
    const oldStatus = cu.old_chat_member?.status;
    const newStatus = cu.new_chat_member?.status;
    if (!oldStatus || !newStatus || !c.chat || !c.from?.id) return null;
    return {
      oldStatus,
      newStatus,
      chat: { id: c.chat.id ?? 0, type: c.chat.type, title: c.chat.title },
      from: { id: c.from.id },
    };
  }
}
