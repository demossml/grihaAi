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
import { recordChatPolicyFromRules } from "../user-rules/chat-policy.js";
import {
  PRESETS,
  presetRulesWithActor,
  type PresetId,
  type PresetRule,
} from "./RulePresets.js";
import type { ChatSetupRecord, ChatSetupStoreFile, SetupStatus } from "./types.js";
import { getScenario } from "../scenarios/registry.js";

export function getChatSetupPath(): string {
  return path.join(getConfigDir(), "chat-setup.json");
}

/**
 * S2: нормализация статуса при чтении старого JSON.
 * legacy completed/skipped → active (семантика «настроен и слушает»).
 */
export function normalizeSetupStatus(status: string | undefined): SetupStatus {
  if (status === "completed" || status === "skipped" || status === "active") return "active";
  if (status === "archived") return "archived";
  return "pending";
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
      if (parsed && parsed.version === 1 && Array.isArray(parsed.chats)) {
        // S2: normalize legacy completed/skipped → active (in-memory only).
        return {
          version: 1,
          chats: parsed.chats.map((c) => ({
            ...c,
            status: normalizeSetupStatus(c.status as string),
          })),
        };
      }
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
    // S2: дедуп по chatId — максимум одна запись на чат (защитная сетка).
    const seen = new Set<string>();
    const deduped = chats.filter((c) => {
      if (seen.has(c.chatId)) return false;
      seen.add(c.chatId);
      return true;
    });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1 as const, chats: deduped }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.filePath);
    this.cache = deduped.map((c) => ({ ...c }));
  }

  async list(): Promise<ChatSetupRecord[]> {
    this.loadSync();
    return this.cache!.map((c) => ({ ...c }));
  }

  /** D8: force=false — hydrate если пуст; force=true — перечитать диск. */
  loadSync(force = false): void {
    if (force || !this.cache) {
      this.cache = this.readStore().chats;
    }
  }

  /** Принудительно перечитать с диска (admin/tests). */
  reload(): void {
    this.loadSync(true);
  }

  /**
   * R1/R5: true → группа настроена (active) — можно применять обычные
   * hard-rules. false → pending/archived/неизвестно → SILENT в группе.
   * Для private не применяется (R6) — решает вызывающий.
   */
  isConfiguredSync(chatId: string): boolean {
    this.loadSync();
    const rec = this.cache!.find((c) => c.chatId === chatId);
    if (!rec) return false;
    return rec.status === "active";
  }

  /** S4: сценарий чата (sync, из cache) — для prefilter belt. */
  getScenarioSync(chatId: string): string | undefined {
    this.loadSync();
    return this.cache!.find((c) => c.chatId === chatId)?.scenario;
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
      // S2: active → без изменений (не затираем настройку).
      if (existing.status === "active") return existing;
      // S2: archived → реактивация.
      if (existing.status === "archived") {
        chats[idx] = {
          ...existing,
          status: "active",
          activatedAt: now,
          chatTitle: input.chatTitle ?? existing.chatTitle,
          chatType: input.chatType,
          updatedAt: now,
        };
      } else {
        // pending → обновить title/type, статус остаётся pending.
        chats[idx] = {
          ...existing,
          chatTitle: input.chatTitle ?? existing.chatTitle,
          chatType: input.chatType,
          updatedAt: now,
        };
      }
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
    rec.status = "active";
    rec.presetId = presetId;
    rec.completedAt = now;
    rec.activatedAt = rec.activatedAt ?? now;
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
    rec.status = "active";
    rec.updatedAt = now;
    rec.completedAt = now;
    rec.activatedAt = rec.activatedAt ?? now;
    await this.save(chats);
  }

  /** S2: уход в архив (kick/left/removal). Данные правил/архива НЕ трогаются. */
  async markArchived(chatId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    const now = new Date().toISOString();
    rec.status = "archived";
    rec.deactivatedAt = now;
    rec.updatedAt = now;
    await this.save(chats);
  }

  /** S2: реактивация из архива (archived → active). Историю НЕ удаляем. */
  async reactivateFromArchived(chatId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec || rec.status !== "archived") return;
    const now = new Date().toISOString();
    rec.status = "active";
    rec.activatedAt = now;
    rec.deactivatedAt = undefined;
    rec.updatedAt = now;
    await this.save(chats);
  }

  /** S2 (optional): отметить последнюю активность в чате. */
  async touchLastSeen(chatId: string): Promise<void> {
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (!rec) return;
    rec.lastSeenAt = new Date().toISOString();
    await this.save(chats);
  }

  /**
   * S3: применить сценарий (namespace scenarios). Ставит record.scenario,
   * применяет defaultPresetId сценария (через applyPreset) и активирует чат.
   * НЕ меняет определение пресета (RulePresets.secretary остаётся прежним).
   */
  async applyScenario(
    chatId: string,
    scenarioId: string,
    opts: { actorId: string },
  ): Promise<void> {
    const scenario = getScenario(scenarioId);
    if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
    const chats = await this.list();
    const rec = chats.find((c) => c.chatId === chatId);
    if (rec) {
      rec.scenario = scenarioId;
      await this.save(chats);
    }
    await this.applyPreset(chatId, scenario.defaultPresetId as PresetId, {
      actorId: opts.actorId,
    });
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
    // PROMPT 06: версионированная policy + audit trail (best-effort).
    try {
      recordChatPolicyFromRules(
        chatId,
        [...this.rules.getHardRules(chatId), ...this.rules.getSoftRules(chatId)],
        { source: `preset:${presetId}`, actorId: opts.actorId },
      );
    } catch (err: unknown) {
      console.warn("[chat-setup] policy record failed:", err instanceof Error ? err.message : err);
    }
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
    // PROMPT 06: версионированная policy + audit trail (best-effort).
    try {
      recordChatPolicyFromRules(
        chatId,
        [...this.rules.getHardRules(chatId), ...this.rules.getSoftRules(chatId)],
        { source: "custom", actorId },
      );
    } catch (err: unknown) {
      console.warn("[chat-setup] policy record failed:", err instanceof Error ? err.message : err);
    }
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
