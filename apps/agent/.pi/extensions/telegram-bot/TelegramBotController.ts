import {
  TelegramBridge,
  type GrishaAgent,
  type RulePreFilter,
  type TelegramResetHandler,
  type TelegramRulesHandler,
  type TgUpdate,
} from "./TelegramBridge.js";

/** Minimal surface of a grammy Bot needed for long polling. */
export interface TelegramBotLike {
  on(filter: "message", handler: (ctx: unknown) => unknown): void;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  api: {
    sendMessage(chatId: number, text: string): Promise<unknown>;
    sendDocument(chatId: number, filePath: string): Promise<unknown>;
  };
}

export interface TelegramBotFactory {
  (token: string): TelegramBotLike;
}

export interface TelegramBotControllerOptions {
  prefilter?: RulePreFilter;
  rulesHandler?: TelegramRulesHandler;
  resetHandler?: TelegramResetHandler;
  /** Send retry policy (injectable for tests). */
  sendRetry?: {
    maxAttempts?: number;
    delayMs?: (attempt: number) => number;
  };
  /** Delay between long-polling reconnects. */
  reconnectDelayMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RECONNECT_DELAY_MS = 10_000;
const DEFAULT_SEND_MAX_ATTEMPTS = 5;

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

  constructor(
    private readonly agent: GrishaAgent,
    private readonly allowedUserIds: number[],
    private readonly botFactory: TelegramBotFactory,
    private readonly options?: TelegramBotControllerOptions,
  ) {}

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
        async (chatId, text, filePath) => {
          const textOk = await this.sendWithRetry(
            () => bot.api.sendMessage(chatId, text),
            "sendMessage",
          );
          let docOk = true;
          if (filePath) {
            docOk = await this.sendWithRetry(
              () => bot.api.sendDocument(chatId, filePath),
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
        },
        {
          prefilter: this.options?.prefilter,
          rulesHandler: this.options?.rulesHandler,
          resetHandler: this.options?.resetHandler,
        },
      );

      bot.on("message", (ctx) => {
        const update = this.toTgUpdate(ctx);
        if (!update) return;
        const msg = update.message;
        console.log(
          `[telegram-bot] incoming message from user=${msg?.from?.id ?? "?"} chat=${msg?.chat?.id ?? "?"} ` +
            `kind=${msg?.text ? "text" : msg?.photo?.length ? "photo" : msg?.document ? "document" : msg?.voice ? "voice" : "other"}`,
        );
        void bridge.handleUpdate(update).catch((err: unknown) => {
          console.error(
            "[telegram-bot] message handling failed:",
            err instanceof Error ? err.message : err,
          );
        });
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
        if (attempt === maxAttempts) {
          console.error(
            `[telegram-bot] ${label} failed after ${maxAttempts} attempts:`,
            err instanceof Error ? err.message : err,
          );
          return false;
        }
        const delay = this.options?.sendRetry?.delayMs?.(attempt) ?? 3000 * attempt;
        console.error(
          `[telegram-bot] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`,
        );
        await this.sleep(delay);
      }
    }
    return false;
  }

  private toTgUpdate(ctx: unknown): TgUpdate | null {
    if (!ctx || typeof ctx !== "object") return null;
    const c = ctx as {
      update?: { update_id?: number };
      message?: {
        from?: { id?: number; first_name?: string };
        chat?: { id?: number };
        text?: string;
        caption?: string;
        voice?: unknown;
        document?: { file_id?: string };
        photo?: Array<{ file_id?: string }>;
      };
    };
    const m = c.message;
    if (!m?.chat) return null;
    return {
      updateId: c.update?.update_id ?? 0,
      message: {
        from: m.from ? { id: m.from.id ?? 0, firstName: m.from.first_name } : undefined,
        chat: { id: m.chat.id ?? 0 },
        text: m.text,
        caption: m.caption,
        voice: m.voice,
        document: m.document,
        photo: m.photo,
      },
    };
  }
}
