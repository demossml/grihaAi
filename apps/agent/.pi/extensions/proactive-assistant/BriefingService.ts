import Database from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS briefing_runs (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  text    TEXT NOT NULL,
  ran_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_briefing_runs_user_day ON briefing_runs(user_id, day_key);
`;

interface RunRow {
  id: string;
  user_id: string;
  day_key: string;
  text: string;
  ran_at: string;
}

/**
 * Daily-briefing duplicate suppression: one briefing per user per local day.
 * The unique index is the enforcement point — a second run for the same day is
 * a no-op unless forced.
 */
export class BriefingService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("BriefingService not initialized — call init() first");
    return this.db;
  }

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

  /** The already-delivered briefing for this user+day, if any. */
  getRun(userId: string, dayKey: string): { text: string } | undefined {
    const row = this.requireDb()
      .prepare(`SELECT * FROM briefing_runs WHERE user_id = ? AND day_key = ?`)
      .get(userId, dayKey) as RunRow | undefined;
    return row ? { text: row.text } : undefined;
  }

  /** Store a delivered briefing. Returns false when one already exists for the day. */
  recordRun(userId: string, dayKey: string, text: string, force = false): boolean {
    const db = this.requireDb();
    if (!force) {
      try {
        db.prepare(
          `INSERT INTO briefing_runs (id, user_id, day_key, text, ran_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(
          `${userId}:${dayKey}`,
          userId,
          dayKey,
          text,
          new Date().toISOString(),
        );
        return true;
      } catch {
        // Unique index violation → already delivered today.
        return false;
      }
    }
    db.prepare(
      `INSERT INTO briefing_runs (id, user_id, day_key, text, ran_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, ran_at = excluded.ran_at`,
    ).run(`${userId}:${dayKey}`, userId, dayKey, text, new Date().toISOString());
    return true;
  }
}
