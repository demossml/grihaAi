/**
 * ChatSetupService — состояние онбординга чатов (JSON store) + применение
 * пресетов через существующий UserRulesService (НЕ параллельный rules engine).
 *
 * Store: ~/.grish-ai/chat-setup.json, атомарная запись tmp+rename.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "@griha/config";
import { getUserRulesService, type UserRulesService } from "../user-rules/UserRulesService.js";
import {
  PRESETS,
  presetRulesWithActor,
  type PresetId,
  type PresetRule,
} from "./RulePresets.js";
import type { ChatSetupRecord, ChatSetupStoreFile } from "./types.js";

export function getChatSetupPath(): string {
  return path.join(getConfigDir(), "chat-setup.json");
}

export interface MarkPendingInput {
  chatId: string;
  chatTitle?: string;
  chatType: string;
  addedByUserId: string;
}

export class ChatSetupService {
  private cache: ChatSetupRecord[] | null = null;

  constructor(
    private readonly filePath: string,
    private readonly rules: UserRulesService,
  ) {}

  private readStore(): ChatSetupStoreFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, chats: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ChatSetupStoreFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.chats)) return parsed;
    } catch (err: unknown) {
      console.error(
        `[chat-setup] chat-setup.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { version: 1, chats: [] };
  }

  private async save(chats: ChatSetupRecord[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1 as const, chats }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.filePath);
    this.cache = chats.map((c) => ({ ...c }));
  }

  async list(): Promise<ChatSetupRecord[]> {
    if (!this.cache) this.cache = this.readStore().chats;
    return this.cache.map((c) => ({ ...c }));
  }

  async get(chatId: string): Promise<ChatSetupRecord | null> {
    const chats = await this.list();
    return chats.find((c) => c.chatId === chatId) ?? null;
  }

  /** Первый add: записать pending (идемпотентно по chatId). */
  async markPending(input: MarkPendingInput): Promise<ChatSetupRecord> {
    const chats = await this.list();
    const idx = chats.findIndex((c) => c.chatId === input.chatId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      const existing = chats[idx];
      if (existing.status === "completed" || existing.status === "skipped") return existing;
      chats[idx] = {
        ...existing,
        chatTitle: input.chatTitle ?? existing.chatTitle,
        chatType: input.chatType,
        updatedAt: now,
      };
    } else {
      const record: ChatSetupRecord = {
        chatId: input.chatId,
        chatTitle: input.chatTitle,
        chatType: input.chatType,
        addedByUserId: input.addedByUserId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      chats.push(record);
      await this.save(chats);
      return record;
    }
    await this.save(chats);
    return chats[idx];
  }

  async markCompleted(chatId: string, presetId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.status = "completed";
    rec.presetId = presetId;
    rec.completedAt = now;
    rec.updatedAt = now;
    rec.waitingCustom = undefined;
    rec.pendingRules = undefined;
    await this.save(chats);
  }

  async markSkipped(chatId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.status = "skipped";
    rec.updatedAt = now;
    rec.completedAt = now;
    await this.save(chats);
  }

  /**
   * Записывает все правила пресета в User Rules (scope=chat, chatId).
   * Предыдущие managed-ключи чата заменяются; чужие custom — не трогаются.
   * silent=true (safe_default при add) не меняет статус — остаётся pending.
   */
  async applyPreset(
    chatId: string,
    presetId: PresetId,
    opts: { actorId: string; silent?: boolean },
  ): Promise<void> {
    const preset = PRESETS[presetId];
    if (!preset) throw new Error(`unknown preset ${presetId}`);
    const rules = presetRulesWithActor(presetId, opts.actorId);
    this.rules.replaceChatManagedRules(chatId, rules, {
      source: `preset:${presetId}`,
      actorId: opts.actorId,
    });
    if (!opts.silent) {
      await this.markCompleted(chatId, presetId);
    }
  }

  /** Custom-путь: сохранить «жду описание от actor». */
  async beginCustom(chatId: string, actorId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.waitingCustom = true;
    rec.pendingRules = undefined;
    rec.updatedAt = now;
    await this.save(chats);
  }

  /** Запись, ждущая custom-текста от actor'а (любой чат). */
  async getWaitingForActor(actorId: string): Promise<ChatSetupRecord | null> {
    const chats = await this.list();
    return (
      chats.find((c) => c.waitingCustom === true && c.addedByUserId === actorId) ?? null
    );
  }

  /** Сохранить распарсенные (не подтверждённые) custom-правила. */
  async setPendingRules(chatId: string, rules: PresetRule[]): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.pendingRules = rules.map((r) => ({ ...r }));
    rec.updatedAt = now;
    await this.save(chats);
  }

  /** confirm: применить pendingRules как managed + status completed (custom). */
  async confirmCustom(chatId: string, actorId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec?.pendingRules?.length) return;
    this.rules.replaceChatManagedRules(chatId, rec.pendingRules, {
      source: "custom",
      actorId,
    });
    await this.markCompleted(chatId, "custom");
  }

  /** cancel: сбросить pending (safe_default остаётся). */
  async cancelCustom(chatId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.waitingCustom = false;
    rec.pendingRules = undefined;
    rec.updatedAt = now;
    await this.save(chats);
  }
}

let singleton: ChatSetupService | null = null;

export function getChatSetupService(): ChatSetupService {
  if (!singleton) {
    singleton = new ChatSetupService(getChatSetupPath(), getUserRulesService());
  }
  return singleton;
}
