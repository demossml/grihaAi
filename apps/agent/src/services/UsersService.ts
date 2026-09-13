/**
 * UsersService — единственный модуль-источник ACL API.
 *
 * - Хранилище: JSON `~/.grish-ai/users.json` (рядом с config).
 * - Запись атомарная: users.json.tmp → rename.
 * - In-memory cache; любая write-операция обновляет cache.
 * - ACL проверяется на КАЖДЫЙ входящий апдейт (isAllowed перечитывает режим).
 */
import fs from "node:fs";
import path from "node:path";
import { getConfigDir, loadConfig } from "@griha/config";
import type { GrishAiConfig } from "@griha/shared-types";
import type {
  AclMode,
  BotUser,
  UserRole,
  UsersAddInput,
  UsersStoreFile,
} from "../types/users.js";
import { normalizeUserId } from "../types/users.js";

/** Путь ACL-файла: ~/.grish-ai/users.json (рядом с config.json). */
export function getUsersPath(): string {
  return path.join(getConfigDir(), "users.json");
}

/** Owner id из config.ownerUserId или env GRISHA_OWNER_ID. */
export function resolveOwnerId(cfg?: GrishAiConfig | null): string | undefined {
  const fromConfig = cfg?.ownerUserId?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.GRISHA_OWNER_ID?.trim();
  return fromEnv || undefined;
}

/**
 * ACL-режим для неизвестных пользователей:
 * - явный config.aclMode (или env ACL_MODE) побеждает;
 * - иначе closed, если задан owner или legacy-whitelist telegram.allowedUserIds;
 * - иначе open (dev-дефолт: как «пускать всех» до настройки ACL).
 */
export function resolveAclMode(cfg?: GrishAiConfig | null): AclMode {
  const explicit = cfg?.aclMode ?? process.env.ACL_MODE;
  if (explicit === "open" || explicit === "closed") return explicit;
  const ownerConfigured = Boolean(resolveOwnerId(cfg));
  const legacyConfigured = (cfg?.telegram?.allowedUserIds?.length ?? 0) > 0;
  return ownerConfigured || legacyConfigured ? "closed" : "open";
}

export interface UsersServiceOptions {
  /** Источник ACL-режима; перечитывается при каждом isAllowed. Default: resolveAclMode(loadConfig()). */
  getAclMode?: () => AclMode;
  /** Статичный режим (если getAclMode не задан). Default: "open". */
  aclMode?: AclMode;
  /** Инжекция времени (тесты). */
  now?: () => Date;
}

export class UsersService {
  private cache: BotUser[] | null = null;
  /** P06: WARN об отсутствии owner — один раз за жизнь сервиса. */
  private ownerWarned = false;

  constructor(
    private readonly filePath: string,
    private readonly options: UsersServiceOptions = {},
  ) {}

  private readStore(): UsersStoreFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, users: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as UsersStoreFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.users)) return parsed;
      console.error("[users-acl] users.json has unexpected shape — treating as empty");
    } catch (err: unknown) {
      console.error(
        `[users-acl] users.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { version: 1, users: [] };
  }

  private mode(): AclMode {
    if (this.options.getAclMode) return this.options.getAclMode();
    return this.options.aclMode ?? "open";
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  /** Атомарная запись: tmp + rename; cache обновляется сразу. */
  private async save(users: BotUser[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1 as const, users }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.filePath);
    this.cache = users.map((u) => ({ ...u }));
  }

  /** Список пользователей (из cache или с диска). */
  async list(): Promise<BotUser[]> {
    if (!this.cache) this.cache = this.readStore().users;
    return this.cache.map((u) => ({ ...u }));
  }

  async get(userId: string | number): Promise<BotUser | null> {
    const id = normalizeUserId(userId);
    const users = await this.list();
    return users.find((u) => u.id === id) ?? null;
  }

  /**
   * Разрешение доступа (проверяется на КАЖДЫЙ апдейт):
   * user в store → role-правила (+ chat-ограничение); иначе → aclMode.
   */
  async isAllowed(userId: string | number, chatId?: string | number): Promise<boolean> {
    const id = normalizeUserId(userId);
    const users = await this.list();
    const u = users.find((x) => x.id === id);

    if (u) {
      if (u.role === "blocked") return false;
      if (u.chats && u.chats.length > 0 && chatId !== undefined) {
        if (!u.chats.map(String).includes(String(chatId))) return false;
      }
      return true;
    }

    return this.mode() === "open";
  }

  /**
   * DM (A2): только явно заведённые пользователи с role !== blocked.
   * Глобальный open-режим НИКОГДА не пускает посторонних в личку.
   */
  async isAllowedPrivate(userId: string | number): Promise<boolean> {
    const u = await this.get(userId);
    return Boolean(u && u.role !== "blocked");
  }

  /** Может ли менять ACL: owner/admin. Главная (не-Telegram) сессия = оператор. */
  async canManage(userId: string | number): Promise<boolean> {
    const id = normalizeUserId(userId);
    if (id === "owner") return true; // main/TUI-сессия без Telegram-контекста
    const u = await this.get(id);
    return u?.role === "owner" || u?.role === "admin";
  }

  /** Idempotent upsert. role "owner" через API запрещён. */
  async add(input: UsersAddInput): Promise<BotUser> {
    const id = normalizeUserId(input.id);
    if (!id) throw new Error("userId required");
    const role: UserRole = input.role ?? "user";
    if (role === "owner") throw new Error("cannot assign owner via API — use config bootstrap");

    const users = await this.list();
    const nowIso = this.now().toISOString();
    const idx = users.findIndex((x) => x.id === id);

    const next: BotUser = {
      id,
      username: input.username?.replace(/^@/, ""),
      displayName: input.displayName,
      role,
      chats: input.chats,
      note: input.note,
      createdAt: idx >= 0 ? users[idx].createdAt : nowIso,
      updatedAt: nowIso,
      createdBy: input.actorId ?? (idx >= 0 ? users[idx].createdBy : undefined),
    };
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...next, createdAt: users[idx].createdAt };
    } else {
      users.push(next);
    }
    await this.save(users);
    return next;
  }

  /** Смена роли. Демоушн/удаление ЕДИНСТВЕННОГО owner запрещены. */
  async setRole(userId: string | number, role: UserRole, actorId?: string): Promise<BotUser> {
    const id = normalizeUserId(userId);
    if (!id) throw new Error("userId required");
    if (role === "owner") throw new Error("cannot assign owner via API — use config bootstrap");

    const users = await this.list();
    const idx = users.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error(`user ${id} not found`);
    if (users[idx].role === "owner") this.guardNotOnlyOwner(users);

    users[idx] = { ...users[idx], role, updatedAt: this.now().toISOString() };
    if (actorId !== undefined) users[idx].createdBy = actorId;
    await this.save(users);
    return users[idx];
  }

  async remove(userId: string | number): Promise<boolean> {
    const id = normalizeUserId(userId);
    const users = await this.list();
    const idx = users.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    if (users[idx].role === "owner") this.guardNotOnlyOwner(users);

    users.splice(idx, 1);
    await this.save(users);
    return true;
  }

  private guardNotOnlyOwner(users: BotUser[]): void {
    const owners = users.filter((u) => u.role === "owner");
    if (owners.length <= 1) throw new Error("cannot demote/remove the only owner");
  }

  /** Bootstrap: owner из config/env. Если id задан — upsert role="owner". */
  async ensureOwner(id?: string | null): Promise<void> {
    const ownerId = normalizeUserId(id ?? "").replace(/^@/, "");
    if (!ownerId) {
      // P06: прод без owner должен быть диагностируем, но не падать при старте.
      if (!this.ownerWarned) {
        this.ownerWarned = true;
        console.warn(
          "[users-acl] Telegram/Users: owner is not configured; management commands are disabled",
        );
      }
      return;
    }
    const users = await this.list();
    const idx = users.findIndex((x) => x.id === ownerId);
    const nowIso = this.now().toISOString();
    if (idx < 0) {
      users.push({ id: ownerId, role: "owner", createdAt: nowIso, updatedAt: nowIso });
    } else {
      users[idx] = { ...users[idx], role: "owner", updatedAt: nowIso };
    }
    await this.save(users);
  }

  /**
   * Миграция legacy-whitelist config.telegram.allowedUserIds: при первом
   * запуске эти id заносятся в store как role="user" (существующая запись
   * не трогается) — развёрнутый whitelist продолжает работать без рестарта.
   */
  async seedLegacyUsers(ids?: Array<number | string> | null): Promise<void> {
    if (!ids || ids.length === 0) return;
    const users = await this.list();
    const nowIso = this.now().toISOString();
    let changed = false;
    for (const raw of ids) {
      const id = normalizeUserId(raw);
      if (!id) continue;
      if (!users.some((u) => u.id === id)) {
        users.push({ id, role: "user", createdAt: nowIso, updatedAt: nowIso });
        changed = true;
      }
    }
    if (changed) await this.save(users);
  }

  /** Invalidate cache и перечитать с диска. */
  async reload(): Promise<void> {
    this.cache = this.readStore().users;
  }
}

let _users: UsersService | null = null;

/** Единственный экземпляр на процесс (как sharedTelegramFetcher). */
export function getUsersService(): UsersService {
  if (!_users) {
    _users = new UsersService(getUsersPath(), { getAclMode: () => resolveAclMode(loadConfig()) });
  }
  return _users;
}
