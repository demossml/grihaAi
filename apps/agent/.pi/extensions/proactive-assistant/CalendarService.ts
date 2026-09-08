import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { CalendarEvent, CalendarEventStatus, EventKind } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  participants TEXT NOT NULL DEFAULT '[]',
  location     TEXT,
  kind         TEXT NOT NULL DEFAULT 'event',
  source       TEXT NOT NULL DEFAULT 'manual',
  status       TEXT NOT NULL DEFAULT 'scheduled',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts ON calendar_events(starts_at);
`;

interface EventRow {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  participants: string;
  location: string | null;
  kind: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EventAddInput {
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  participants?: string[];
  location?: string;
  kind?: EventKind;
  source?: string;
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    participants: JSON.parse(row.participants) as string[],
    location: row.location ?? undefined,
    kind: row.kind as EventKind,
    source: row.source,
    status: row.status as CalendarEventStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Connector-ready internal calendar. Stores events that Grisha actually knows
 * about; it never claims an external calendar was changed (that requires a
 * future connector + approval for calendar.write).
 */
export class CalendarService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("CalendarService not initialized — call init() first");
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

  add(input: EventAddInput): CalendarEvent {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO calendar_events
       (id, user_id, title, starts_at, ends_at, timezone, participants, location, kind, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).run(
      id,
      input.userId,
      input.title,
      input.startsAt,
      input.endsAt,
      input.timezone ?? "UTC",
      JSON.stringify(input.participants ?? []),
      input.location ?? null,
      input.kind ?? "event",
      input.source ?? "manual",
      now,
      now,
    );
    return this.get(id)!;
  }

  get(id: string): CalendarEvent | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(id) as
      | EventRow
      | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  list(userId: string, options?: { from?: string; to?: string; kind?: EventKind }): CalendarEvent[] {
    const db = this.requireDb();
    let sql = `SELECT * FROM calendar_events WHERE user_id = ?`;
    const params: unknown[] = [userId];
    if (options?.from) {
      sql += ` AND starts_at >= ?`;
      params.push(options.from);
    }
    if (options?.to) {
      sql += ` AND starts_at <= ?`;
      params.push(options.to);
    }
    if (options?.kind) {
      sql += ` AND kind = ?`;
      params.push(options.kind);
    }
    sql += ` ORDER BY starts_at ASC`;
    const rows = db.prepare(sql).all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  cancel(id: string): CalendarEvent | undefined {
    const db = this.requireDb();
    const existing = this.get(id);
    if (!existing) return undefined;
    db.prepare(`UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      id,
    );
    return this.get(id);
  }
}
