import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DoctorCheck } from "./types.js";

/**
 * Offline-чеки окружения Telegram-бота. Чистые функции: без grammy, без сети,
 * без better-sqlite3. Токен НИКОГДА не попадает в message/fix.
 */

export interface OfflineChecksContext {
  /** Полный путь к config.json (default ~/.grish-ai/config.json). */
  configPath?: string;
  /** Домашний каталог (default os.homedir()). */
  homeDir?: string;
  /** Корень монорепо для проверки render-cli (default process.cwd()). */
  repoRoot?: string;
}

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;

function checkConfigPresent(configPath: string): DoctorCheck {
  if (fs.existsSync(configPath)) {
    return { id: "config-present", status: "pass", message: "config.json найден" };
  }
  return {
    id: "config-present",
    status: "fail",
    message: `config.json не найден: ${configPath}`,
    fix: "Создайте ~/.grish-ai/config.json (provider/model/telegram.botToken)",
  };
}

function readBotToken(configPath: string): string | undefined {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as { telegram?: { botToken?: string } };
    return config?.telegram?.botToken;
  } catch {
    return undefined;
  }
}

function checkTokenFormat(configPath: string): DoctorCheck {
  const token = readBotToken(configPath);
  if (!token) {
    return {
      id: "telegram-token-format",
      status: "fail",
      message: "бот-токен не задан (TELEGRAM_BOT_TOKEN или config.telegram.botToken)",
      fix: "Укажите telegram.botToken в config.json",
    };
  }
  if (TOKEN_RE.test(token)) {
    return { id: "telegram-token-format", status: "pass", message: "бот-токен задан и соответствует формату" };
  }
  return {
    id: "telegram-token-format",
    status: "fail",
    message: "бот-токен не соответствует формату <digits>:<30+ [A-Za-z0-9_-]>",
    fix: "Проверьте значение токена",
  };
}

function checkProxyMode(): DoctorCheck {
  const proxy = process.env.TELEGRAM_USE_PROXY;
  if (proxy && proxy !== "0" && proxy.toLowerCase() !== "false") {
    return { id: "proxy-mode", status: "pass", message: "TELEGRAM_USE_PROXY включён" };
  }
  return { id: "proxy-mode", status: "pass", message: "proxy не используется (TELEGRAM_USE_PROXY не задан)" };
}

function checkDbFile(dbPath: string): DoctorCheck {
  if (!fs.existsSync(dbPath)) {
    return { id: "db-file", status: "warn", message: "documents.sqlite не найден", fix: "Создастся при первом запуске" };
  }
  try {
    fs.accessSync(dbPath, fs.constants.R_OK);
    return { id: "db-file", status: "pass", message: "documents.sqlite доступен на чтение" };
  } catch {
    return { id: "db-file", status: "fail", message: "documents.sqlite есть, но недоступен на чтение" };
  }
}

function checkMediaDir(mediaDir: string): DoctorCheck {
  try {
    if (fs.statSync(mediaDir).isDirectory()) {
      return { id: "media-dir", status: "pass", message: "media-каталог найден" };
    }
  } catch {
    /* not a dir */
  }
  return { id: "media-dir", status: "warn", message: "media-каталог не найден", fix: "Создастся при первом приёме медиа" };
}

function checkRenderCliBinary(binPath: string): DoctorCheck {
  if (fs.existsSync(binPath)) {
    return { id: "render-cli-binary", status: "pass", message: "render-cli собран" };
  }
  return {
    id: "render-cli-binary",
    status: "warn",
    message: "apps/render-cli/dist/bin.js не найден",
    fix: "npm run build -w @griha/render-cli",
  };
}

export async function runOfflineChecks(ctx: OfflineChecksContext = {}): Promise<DoctorCheck[]> {
  const homeDir = ctx.homeDir ?? os.homedir();
  const grishDir = path.join(homeDir, ".grish-ai");
  const configPath = ctx.configPath ?? path.join(grishDir, "config.json");
  const repoRoot = ctx.repoRoot ?? process.cwd();

  return [
    checkConfigPresent(configPath),
    checkTokenFormat(configPath),
    checkProxyMode(),
    checkDbFile(path.join(grishDir, "documents.sqlite")),
    checkMediaDir(path.join(grishDir, "media", "telegram")),
    checkRenderCliBinary(path.join(repoRoot, "apps/render-cli/dist/bin.js")),
  ];
}
