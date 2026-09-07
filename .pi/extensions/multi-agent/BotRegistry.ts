import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BotConfig, BotId, ProjectId } from "../../../src/types/index.js";

type BotDraft = Omit<BotConfig, "id" | "createdAt" | "updatedAt">;

/**
 * File-backed registry of named specialist bots (Hermes Bot Mode spirit).
 * Each bot is stored as a single JSON file: `<id>.json`.
 */
export class BotRegistry {
  constructor(private readonly dir: string) {}

  private fileFor(id: BotId): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async create(config: BotDraft): Promise<BotConfig> {
    await this.ensureDir();
    const now = new Date().toISOString();
    const bot: BotConfig = {
      ...config,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await fs.writeFile(this.fileFor(bot.id), JSON.stringify(bot, null, 2), "utf8");
    return bot;
  }

  async get(id: BotId): Promise<BotConfig | null> {
    try {
      const raw = await fs.readFile(this.fileFor(id), "utf8");
      return JSON.parse(raw) as BotConfig;
    } catch {
      return null;
    }
  }

  async list(projectId?: ProjectId): Promise<BotConfig[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return [];
    }

    const bots: BotConfig[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, entry), "utf8");
        const bot = JSON.parse(raw) as BotConfig;
        if (projectId && bot.projectId !== projectId) continue;
        bots.push(bot);
      } catch {
        // Skip unreadable/corrupt bot files.
      }
    }
    return bots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: BotId): Promise<boolean> {
    try {
      await fs.unlink(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }
}
