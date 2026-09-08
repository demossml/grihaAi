import fs from "node:fs";
import path from "node:path";
import type { GrishAiConfig } from "@griha/shared-types";

export const CONFIG_DIR_NAME = ".grish-ai";
export const CONFIG_FILE_NAME = "config.json";

/**
 * Directory holding grish-ai config.
 *
 * Defaults to `~/.grish-ai`. `GRISH_AI_HOME` overrides the base directory,
 * which is useful for tests and for isolated installs.
 */
export function getConfigDir(): string {
  const base = process.env.GRISH_AI_HOME ?? process.env.HOME ?? process.cwd();
  return path.join(base, CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): GrishAiConfig | null {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as GrishAiConfig;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      typeof parsed.provider === "string" &&
      typeof parsed.model === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: GrishAiConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    // Каталог создаёт этот модуль — сразу owner-only (0o700), не шире, чем нужно.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  // mode в writeFileSync не меняет права УЖЕ существующего файла — явный chmod.
  // В файле лежат API-ключ провайдера и Telegram bot token: только владелец.
  fs.chmodSync(getConfigPath(), 0o600);
}
