import { Bot, InputFile } from "grammy";
import os from "node:os";
import path from "node:path";
import { buildBotOptions, resolveProxyUrl } from "./proxy.js";
import {
  sharedTelegramFetcher,
  startPeriodicIpRefresh,
} from "./telegram-network.js";
import {
  getDocumentIngestService,
  maybeIngestDocument,
} from "../../../src/services/documents/index.js";
import { downloadTelegramFileToDisk } from "../../../src/utils/telegram/telegram-files.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GrishaAgent } from "./TelegramBridge.js";
import {
  TelegramBotController,
  type TelegramBotFactory,
} from "./TelegramBotController.js";
import { TelegramSessionPool } from "./TelegramSessionPool.js";
import { loadConfig, saveConfig } from "@griha/config";
import { shouldProcessMessage } from "../user-rules/prefilter.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { telegramRulesHandler } from "../user-rules/index.js";
import { applyApprovalDecision } from "../approval-gate/index.js";
import { getUsersService, resolveOwnerId } from "../../../src/services/UsersService.js";
import { handleUsersCommand } from "../../../src/services/users-command.js";
import {
  getChatSetupService,
} from "../chat-setup/ChatSetupService.js";
import {
  handleSetupCallback,
  onChatMemberAdded,
  runSetupCommand,
  tryHandleCustomText,
} from "../chat-setup/handlers.js";
import { mapChatMemberStatus } from "./chat-auth.js";
import { transcribeVoice } from "@griha/stt";

// Один раз на процесс: первичное обнаружение IP + периодическое (10 минут).
// Не должно повторяться на каждом реконнекте бота (иначе плодятся таймеры).
startPeriodicIpRefresh(sharedTelegramFetcher);
void sharedTelegramFetcher.refreshIps().catch(() => {});

// self-инфо бота (id/username) — для расчёта mention/reply флагов pre-filter'а.
let botSelf: { id: number; username?: string } | undefined;

/**
 * Adapts the real grammy Bot to the framework-free `TelegramBotLike` surface.
 * Document delivery wraps the path in grammy's `InputFile` (a raw string would
 * be treated as a remote file_id, not a local file).
 *
 * Сеть: по умолчанию Telegram ходит напрямую через кастомную fetch поверх
 * node:https (DoH-обнаружение + мульти-IP sticky + keep-alive) — Telegram из РФ
 * блокируется по отдельным IP, поэтому один прокси с захардкоженным IP ненадёжен.
 * Legacy-путь через HTTPS_PROXY включается только TELEGRAM_USE_PROXY=1.
 */
const realBotFactory: TelegramBotFactory = (token) => {
  const proxyUrl = resolveProxyUrl();
  let bot: Bot;
  if (process.env.TELEGRAM_USE_PROXY === "1" && proxyUrl) {
    console.log("[telegram-bot] using HTTPS proxy for Telegram API (legacy TELEGRAM_USE_PROXY=1)");
    bot = new Bot(token, buildBotOptions(proxyUrl)!);
  } else {
    bot = new Bot(token, {
      // Типы fetch в grammy (node-fetch) и @types/node (undici) несовместимы
      // номинально; сигнатура нашей реализации соответствует им обоим.
      client: { fetch: sharedTelegramFetcher.fetch as never },
    });
  }
  return {
    on: (filter, handler) => {
      if (filter === "callback_query:data") {
        void bot.on("callback_query:data", (gctx) => {
          const cbq = gctx.callbackQuery;
          void handler({
            from: cbq?.from?.id != null ? { id: cbq.from.id } : undefined,
            data: cbq?.data,
            message: cbq?.message
              ? {
                  chat: cbq.message.chat?.id != null ? { id: cbq.message.chat.id } : undefined,
                  message_id: cbq.message.message_id,
                  text: cbq.message.text,
                }
              : undefined,
            answerCallbackQuery: (text, extra) =>
              gctx.answerCallbackQuery(text !== undefined ? { text, show_alert: extra?.showAlert } : {}),
            editMessageText: (text, extra) =>
              gctx.editMessageText(text, {
                // Исходное сообщение отправлялось как HTML — редактируем в том же режиме.
                parse_mode: "HTML",
                ...(extra?.removeKeyboard ? { reply_markup: { inline_keyboard: [] } } : {}),
              }),
          });
        });
        return;
      }
      void bot.on(filter, handler as never);
    },
    start: async () => {
      // D6: self-инфо для mention/reply-флагов — до group traffic; retry при
      // каждом новом bot instance (pollLoop), с логом ошибки.
      if (!botSelf) {
        try {
          const me = await bot.api.getMe();
          botSelf = { id: me.id, username: me.username };
        } catch (err: unknown) {
          console.error(
            "[telegram-bot] getMe failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return bot.start();
    },
    stop: () => bot.stop(),
    api: {
      sendMessage: (chatId, text, extra) =>
        bot.api.sendMessage(chatId, text, {
          ...(extra?.parseMode ? { parse_mode: extra.parseMode } : {}),
          ...(extra?.messageThreadId ? { message_thread_id: extra.messageThreadId } : {}),
          ...(extra?.inlineButtons
            ? {
                reply_markup: {
                  inline_keyboard: extra.inlineButtons.map((row) =>
                    row.map((button) => ({
                      text: button.text,
                      callback_data: button.callbackData,
                    })),
                  ),
                },
              }
            : {}),
        }),
      sendDocument: (chatId, filePath, extra) =>
        bot.api.sendDocument(chatId, new InputFile(filePath), {
          ...(extra?.caption ? { caption: extra.caption } : {}),
        }),
      sendChatAction: (chatId, action) => bot.api.sendChatAction(chatId, action),
      setMyCommands: (commands) => bot.api.setMyCommands(commands),
      setMessageReaction: (chatId, messageId, reaction) =>
        // grammy типизирует emoji как литеральный union — здесь строка из бриджа.
        bot.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: reaction as never }]),
      getChatMember: (chatId, userId) => bot.api.getChatMember(chatId, userId),
    },
  };
};

let controller: TelegramBotController | null = null;
let pool: TelegramSessionPool | null = null;

function grishaAgent(): GrishaAgent {
  return async (input) => {
    if (!pool) return { text: "Гриша временно недоступен." };
    // D2: пул ключуется sessionKey (чай/тема), не только userId.
    return pool.handleMessage(input.sessionKey, input.userId, input.message, {
      chatId: input.chatId,
      threadId: input.threadId,
    });
  };
}

function getController(): TelegramBotController {
  if (!controller) {
    const cfg = loadConfig();
    // Users ACL: единственный сервис на процесс; входящие апдейты проверяются
    // по нему на каждый апдейт (disk store + cache, writes — без рестарта).
    const users = getUsersService();
    const setup = getChatSetupService();
    controller = new TelegramBotController(
      grishaAgent(),
      cfg?.telegram?.allowedUserIds ?? [],
      realBotFactory,
      {
        prefilter: (input) =>
          shouldProcessMessage(getUserRulesService().getHardRules(input.chatId), input),
        rulesHandler: telegramRulesHandler,
        resetHandler: (sessionKey) => pool?.reset(sessionKey),
        approvalHandler: (action, id) => applyApprovalDecision(action, id).message,
        aclCheck: (userId, chatId) => users.isAllowed(userId, chatId),
        usersCommandHandler: (args, ctx) => handleUsersCommand(users, args, ctx),
        // Chat-setup (онбординг групп): my_chat_member → DM, cs:-callbacks,
        // custom-текст в DM, /setup с keyboard'ами (D5).
        chatMemberHandler: (event, deps) =>
          onChatMemberAdded(event, { setup, users, sendMessage: deps.sendMessage }),
        setupCallbackHandler: (data, ctx, deps) =>
          handleSetupCallback(data, ctx, {
            setup,
            users,
            sendMessage: async () => undefined,
            // Пакет B: статус actor в группе — из реального getChatMember.
            getChatMember: async (chatId, userId) =>
              mapChatMemberStatus((await deps.getChatMember(Number(chatId), Number(userId))).status),
          }),
        setupCommandHandler: (args, ctx, send, deps) =>
          runSetupCommand(args, ctx, {
            setup,
            users,
            sendMessage: async (chatId, text, extra) => {
              await send(chatId, text, undefined, extra);
            },
            getChatMember: async (chatId, userId) =>
              mapChatMemberStatus((await deps.getChatMember(Number(chatId), Number(userId))).status),
          }),
        pendingGroupsHint: async (userId) => {
          // D9: только группы, добавленные этим пользователем.
          const pending = (await setup.list()).filter(
            (c) => c.status === "pending" && c.addedByUserId === userId,
          );
          return pending.length > 0
            ? `\n\nЕсть группы без настройки: ${pending.length}. Отправьте /setup чтобы получить кнопки.`
            : "";
        },
        // D3: голос транскрибируется до агента (STT через @griha/stt).
        transcribeVoice: async (fileId) => {
          const token = loadConfig()?.telegram?.botToken;
          if (!token) throw new Error("STT not configured");
          const dest = path.join(
            os.tmpdir(),
            `griha-voice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          );
          const filePath = await downloadTelegramFileToDisk(token, fileId, dest);
          try {
            const result = await transcribeVoice(filePath, {});
            if (!result.ok || !result.text.trim()) throw new Error("empty transcription");
            return result.text;
          } finally {
            const fs = await import("node:fs/promises");
            await fs.rm(filePath, { force: true }).catch(() => undefined);
          }
        },
        customSetupInterceptor: (input, send) =>
          tryHandleCustomText(input, { setup }, async (chatId, text, extra) => {
            await send(chatId, text, undefined, extra);
          }),
        getBotSelf: () => botSelf,
        // R1: pending-группа silent (онбординг не завершён → prefilter false).
        getGroupConfigured: (chatId) => setup.isConfiguredSync(chatId),
        // Чек/накладная: инжест в expenses store (mention-policy, ACL, дедуп).
        documentIngest: (msg) =>
          maybeIngestDocument(msg as unknown as Parameters<typeof maybeIngestDocument>[0], {
            getIngestMode: (chatId) => {
              const svc = getUserRulesService();
              const rules = [...svc.getHardRules(chatId), ...svc.getSoftRules(chatId)];
              const value = [...rules]
                .reverse()
                .find((r) => r.key === "ingest_mode")?.value;
              return typeof value === "string" ? value : "mention";
            },
            isAllowed: (userId, chatId) => users.isAllowed(userId, chatId),
            ingest: (m) => {
              const token = loadConfig()?.telegram?.botToken;
              if (!token) return Promise.reject(new Error("no botToken"));
              return getDocumentIngestService().ingestFromTelegram(m, {
                download: async (fileId) => {
                  const dest = path.join(
                    os.tmpdir(),
                    `griha-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  );
                  return downloadTelegramFileToDisk(token, fileId, dest);
                },
              });
            },
          }),
      },
    );
  }
  return controller;
}

/**
 * Bootstrap ACL при старте: legacy-whitelist → role="user", owner из
 * config.ownerUserId/env GRISHA_OWNER_ID → role="owner" (не затирая поля).
 */
async function bootstrapUsers(): Promise<void> {
  const cfg = loadConfig();
  const users = getUsersService();
  await users.seedLegacyUsers(cfg?.telegram?.allowedUserIds);
  await users.ensureOwner(resolveOwnerId(cfg));
  // R1: hydrate chat-setup cache до старта long polling (isConfiguredSync).
  getChatSetupService().loadSync();
}

async function startBot(): Promise<boolean> {
  const token = loadConfig()?.telegram?.botToken;
  if (!token) {
    console.warn("[telegram-bot] startBot: no botToken configured");
    return false;
  }
  try {
    await bootstrapUsers();
    getController().start(token);
    return true;
  } catch (err: unknown) {
    console.error("[telegram-bot] startBot error:", err);
    return false;
  }
}

async function stopBot(): Promise<void> {
  await controller?.stop();
}

export default function telegramBot(pi: ExtensionAPI): void {
  pool = new TelegramSessionPool();

  pi.on("session_start", () => {
    void startBot();
  });

  pi.on("session_shutdown", async () => {
    await stopBot();
    await pool?.disposeAll();
    pool = null;
    controller = null;
  });

  pi.on("before_agent_start", async (event) => {
    const configured = Boolean(loadConfig()?.telegram?.botToken);
    const note = [
      "## Telegram-бот (long polling)",
      configured
        ? "Встроенный Telegram-бот активен. Команды: /telegram-setup (перенастройка), /telegram-status (статус), /telegram-stop, /telegram-start."
        : "Встроенный Telegram-бот есть, но не настроен. Чтобы включить: получить токен у @BotFather и выполнить /telegram-setup.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${note}` };
  });

  pi.registerCommand("telegram-setup", {
    description: "Set up the Telegram bot (token + allowed users)",
    async handler(_args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify("Telegram setup needs interactive mode.", "error");
        return;
      }
      const cfg = loadConfig();
      if (!cfg) {
        ctx.ui.notify("No config found — run /setup first.", "error");
        return;
      }

      const token = await ctx.ui.input("Telegram bot token:", "");
      if (!token?.trim()) return;

      const usersRaw = await ctx.ui.input("Allowed user ids (comma-separated, optional):", "");
      const allowed = (usersRaw ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);

      cfg.telegram = { botToken: token.trim(), allowedUserIds: allowed };
      saveConfig(cfg);

      await stopBot();
      controller = null;
      await startBot();

      ctx.ui.notify("Telegram bot configured (long polling).", "info");
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Show Telegram bot status",
    async handler() {
      const tg = loadConfig()?.telegram;
      const running = controller?.isRunning() ?? false;
      const text = !tg
        ? "Telegram bot не настроен. Используй /telegram-setup."
        : `Token: ${tg.botToken ? "set" : "missing"}\nAllowed users: ${tg.allowedUserIds?.length ?? 0}\nRunning: ${running ? "да (long polling)" : "нет"}\nActive user sessions: ${pool?.activeCount() ?? 0}`;
      pi.sendMessage({
        customType: "telegram-status",
        content: [{ type: "text", text }],
        display: true,
      });
    },
  });

  pi.registerCommand("telegram-start", {
    description: "Start Telegram long polling",
    async handler() {
      const started = await startBot();
      pi.sendMessage({
        customType: "telegram-start",
        content: [
          {
            type: "text",
            text: started
              ? "Telegram bot started (long polling)."
              : "No bot token configured — run /telegram-setup.",
          },
        ],
        display: true,
      });
    },
  });

  pi.registerCommand("telegram-stop", {
    description: "Stop Telegram long polling",
    async handler() {
      await stopBot();
      pi.sendMessage({
        customType: "telegram-stop",
        content: [{ type: "text", text: "Telegram bot stopped." }],
        display: true,
      });
    },
  });
}
