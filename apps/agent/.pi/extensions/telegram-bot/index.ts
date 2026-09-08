import { Bot } from "grammy";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GrishaAgent } from "./TelegramBridge.js";
import {
  TelegramBotController,
  type TelegramBotFactory,
  type TelegramBotLike,
} from "./TelegramBotController.js";
import { TelegramSessionPool } from "./TelegramSessionPool.js";
import { loadConfig, saveConfig } from "@griha/config";
import { shouldProcessMessage } from "../user-rules/prefilter.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { telegramRulesHandler } from "../user-rules/index.js";

const realBotFactory: TelegramBotFactory = (token) =>
  new Bot(token) as unknown as TelegramBotLike;

let controller: TelegramBotController | null = null;
let pool: TelegramSessionPool | null = null;

function grishaAgent(): GrishaAgent {
  return async (input) => {
    if (!pool) return "Гриша временно недоступен.";
    return pool.handleMessage(input.userId, input.chatId, input.message);
  };
}

function getController(): TelegramBotController {
  if (!controller) {
    const cfg = loadConfig();
    controller = new TelegramBotController(
      grishaAgent(),
      cfg?.telegram?.allowedUserIds ?? [],
      realBotFactory,
      {
        prefilter: (input) =>
          shouldProcessMessage(getUserRulesService().getHardRules(input.chatId), input),
        rulesHandler: telegramRulesHandler,
      },
    );
  }
  return controller;
}

function startBot(): boolean {
  const token = loadConfig()?.telegram?.botToken;
  if (!token) return false;
  try {
    getController().start(token);
    return true;
  } catch {
    return false;
  }
}

async function stopBot(): Promise<void> {
  await controller?.stop();
}

export default function telegramBot(pi: ExtensionAPI): void {
  pool = new TelegramSessionPool();

  pi.on("session_start", () => {
    startBot();
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
      startBot();

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
      const started = startBot();
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
