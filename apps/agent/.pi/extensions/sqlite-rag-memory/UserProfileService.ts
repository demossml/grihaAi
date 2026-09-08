import Database from "better-sqlite3";
import type { UserProfile } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  role TEXT,
  timezone TEXT,
  language TEXT,
  communication_style TEXT,
  preferences TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`;

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  role: string | null;
  timezone: string | null;
  language: string | null;
  communication_style: string | null;
  preferences: string;
  updated_at: string;
}

export class UserProfileService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("UserProfileService not initialized — call init() first");
    return this.db;
  }

  async init(): Promise<void> {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const db = this.requireDb();
    const row = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(userId) as
      | ProfileRow
      | undefined;
    return row ? this.rowToProfile(row) : null;
  }

  async upsertProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
    const db = this.requireDb();
    const existing = await this.getProfile(userId);
    const merged: UserProfile = {
      userId,
      displayName: patch.displayName ?? existing?.displayName,
      role: patch.role ?? existing?.role,
      timezone: patch.timezone ?? existing?.timezone,
      language: patch.language ?? existing?.language,
      communicationStyle: patch.communicationStyle ?? existing?.communicationStyle,
      preferences: { ...(existing?.preferences ?? {}), ...(patch.preferences ?? {}) },
      updatedAt: new Date().toISOString(),
    };

    db.prepare(
      `INSERT INTO user_profiles (user_id, display_name, role, timezone, language, communication_style, preferences, updated_at)
       VALUES (@user_id, @display_name, @role, @timezone, @language, @communication_style, @preferences, @updated_at)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         timezone = excluded.timezone,
         language = excluded.language,
         communication_style = excluded.communication_style,
         preferences = excluded.preferences,
         updated_at = excluded.updated_at`,
    ).run({
      user_id: userId,
      display_name: merged.displayName ?? null,
      role: merged.role ?? null,
      timezone: merged.timezone ?? null,
      language: merged.language ?? null,
      communication_style: merged.communicationStyle ?? null,
      preferences: JSON.stringify(merged.preferences),
      updated_at: merged.updatedAt,
    });

    return merged;
  }

  async setPreference(userId: string, key: string, value: string): Promise<void> {
    const existing = await this.getProfile(userId);
    await this.upsertProfile(userId, {
      preferences: { ...(existing?.preferences ?? {}), [key]: value },
    });
  }

  private rowToProfile(row: ProfileRow): UserProfile {
    return {
      userId: row.user_id,
      displayName: row.display_name ?? undefined,
      role: row.role ?? undefined,
      timezone: row.timezone ?? undefined,
      language: row.language ?? undefined,
      communicationStyle: row.communication_style ?? undefined,
      preferences: JSON.parse(row.preferences || "{}") as Record<string, string>,
      updatedAt: row.updated_at,
    };
  }
}
