/**
 * R7 — реестр участников групп (Griha-роли, НЕ Telegram-админы).
 * SQLite `~/.grish-ai/group-participants.sqlite` (отдельный файл, не трогает users.json).
 *
 * Upsert на каждом групповом сообщении (роль сохраняется, если уже есть).
 * setRole — только canManage (owner/admin).
 * Роли: owner | admin | member | finance.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { getConfigDir } from "@griha/config";

export type ParticipantRole = "owner" | "admin" | "member" | "finance";

export interface GroupParticipant {
  chatId: string;
  userId: string;
  displayName: string;
  role: ParticipantRole;
  lastSeenAt: string;
}

export interface ParticipantUpsertInput {
  chatId: string;
  userId: string;
  displayName?: string;
  role?: ParticipantRole;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS group_participants (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
`;

interface ParticipantRow {
  chat_id: string;
  user_id: string;
  display_name: string | null;
  role: string;
  last_seen_at: string;
}

function rowToParticipant(row: ParticipantRow): GroupParticipant {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    displayName: row.display_name ?? "",
    role: row.role as ParticipantRole,
    lastSeenAt: row.last_seen_at,
  };
}

export function getGroupParticipantsDbPath(): string {
  return path.join(getConfigDir(), "group-participants.sqlite");
}

export class GroupParticipantService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  init(): void {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("GroupParticipantService not initialized — call init() first");
    return this.db;
  }

  get(chatId: string, userId: string): GroupParticipant | undefined {
    const row = this.requireDb()
      .prepare(`SELECT * FROM group_participants WHERE chat_id = ? AND user_id = ?`)
      .get(chatId, userId) as ParticipantRow | undefined;
    return row ? rowToParticipant(row) : undefined;
  }

  /** Idempotent upsert: сохраняет существующую роль (не понижает). */
  upsert(input: ParticipantUpsertInput): GroupParticipant {
    const db = this.requireDb();
    const existing = this.get(input.chatId, input.userId);
    const role: ParticipantRole = existing ? existing.role : (input.role ?? "member");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO group_participants (chat_id, user_id, display_name, role, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`,
    ).run(input.chatId, input.userId, input.displayName ?? "", role, now);
    return this.get(input.chatId, input.userId)!;
  }

  listByChat(chatId: string): GroupParticipant[] {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM group_participants WHERE chat_id = ? ORDER BY user_id ASC`)
      .all(chatId) as ParticipantRow[];
    return rows.map(rowToParticipant);
  }

  /**
   * Назначить роль участнику. Только canManage (owner/admin); иначе throw.
   * Роль "owner" через этот API запрещён (как в UsersService — bootstrap через config).
   */
  setRole(
    chatId: string,
    userId: string,
    role: ParticipantRole,
    opts: { canManage: boolean },
  ): GroupParticipant {
    if (!opts.canManage) throw new Error("only canManage can assign roles");
    if (role === "owner") throw new Error("cannot assign owner via API");
    const db = this.requireDb();
    db.prepare(`UPDATE group_participants SET role = ? WHERE chat_id = ? AND user_id = ?`).run(
      role,
      chatId,
      userId,
    );
    const updated = this.get(chatId, userId);
    if (!updated) throw new Error("participant not found");
    return updated;
  }
}

let singleton: GroupParticipantService | null = null;

export function getGroupParticipantService(): GroupParticipantService {
  if (!singleton) {
    singleton = new GroupParticipantService(getGroupParticipantsDbPath());
    singleton.init();
  }
  return singleton;
}
