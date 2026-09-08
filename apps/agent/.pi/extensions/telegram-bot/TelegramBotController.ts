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

/**
 * Owns a long-polling Telegram bot: wires incoming messages to the bridge,
 * starts/stops polling. The bot is created via an injected factory so the
 * lifecycle is unit-testable without a real token.
 */
export class TelegramBotController {
  private bot: TelegramBotLike | null = null;
  private running = false;

  constructor(
    private readonly agent: GrishaAgent,
    private readonly allowedUserIds: number[],
    private readonly botFactory: TelegramBotFactory,
    private readonly options?: {
      prefilter?: RulePreFilter;
      rulesHandler?: TelegramRulesHandler;
      resetHandler?: TelegramResetHandler;
    },
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  start(token: string): void {
    if (this.running) return;
    const bot = this.botFactory(token);
    this.bot = bot;

    const bridge = new TelegramBridge(
      this.allowedUserIds,
      this.agent,
      async (chatId, text, filePath) => {
        await bot.api.sendMessage(chatId, text);
        if (filePath) await bot.api.sendDocument(chatId, filePath);
      },
      this.options,
    );

    bot.on("message", (ctx) => {
      const update = this.toTgUpdate(ctx);
      if (update) void bridge.handleUpdate(update);
    });

    this.running = true;
    void bot.start().catch((err: unknown) => {
      const reason =
        err instanceof Error
          ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ""}`
          : String(err);
      console.error("[telegram-bot] Failed to start long polling:", reason);
      this.running = false;
      this.bot = null;
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.bot) return;
    await this.bot.stop();
    this.bot = null;
    this.running = false;
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
