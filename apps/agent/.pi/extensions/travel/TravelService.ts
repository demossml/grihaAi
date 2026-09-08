import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TravelItem, TravelItemKind } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS travel_items (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  trip_id          TEXT NOT NULL,
  kind             TEXT NOT NULL,
  title            TEXT NOT NULL,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  location         TEXT,
  confirmation_ref TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_travel_items_user_trip ON travel_items(user_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_travel_items_starts ON travel_items(starts_at);
`;

interface TravelRow {
  id: string;
  user_id: string;
  trip_id: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  confirmation_ref: string | null;
  source: string;
  created_at: string;
}

export interface TravelItemAddInput {
  userId: string;
  tripId: string;
  kind: TravelItemKind;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  confirmationRef?: string;
  source?: string;
}

function rowToTravel(row: TravelRow): TravelItem {
  return {
    id: row.id,
    userId: row.user_id,
    tripId: row.trip_id,
    kind: row.kind as TravelItemKind,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location ?? undefined,
    confirmationRef: row.confirmation_ref ?? undefined,
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * Travel storage (connector-ready). Booking confirmations, PDFs and
 * screenshots are ingested via OCR/vision and stored as structured itinerary
 * items; actual booking is NOT implemented.
 */
export class TravelService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("TravelService not initialized — call init() first");
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

  add(input: TravelItemAddInput): TravelItem {
    const db = this.requireDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO travel_items
       (id, user_id, trip_id, kind, title, starts_at, ends_at, location, confirmation_ref, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      input.tripId,
      input.kind,
      input.title,
      input.startsAt,
      input.endsAt,
      input.location ?? null,
      input.confirmationRef ?? null,
      input.source ?? "manual",
      new Date().toISOString(),
    );
    return this.get(id)!;
  }

  get(id: string): TravelItem | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM travel_items WHERE id = ?`).get(id) as
      | TravelRow
      | undefined;
    return row ? rowToTravel(row) : undefined;
  }

  list(userId: string, tripId?: string): TravelItem[] {
    const db = this.requireDb();
    const rows = tripId
      ? (db
          .prepare(`SELECT * FROM travel_items WHERE user_id = ? AND trip_id = ? ORDER BY starts_at ASC`)
          .all(userId, tripId) as TravelRow[])
      : (db
          .prepare(`SELECT * FROM travel_items WHERE user_id = ? ORDER BY starts_at ASC`)
          .all(userId) as TravelRow[]);
    return rows.map(rowToTravel);
  }

  /** Items starting within the next N days (for reminders). */
  upcoming(userId: string, days: number, now: Date = new Date()): TravelItem[] {
    const horizon = now.getTime() + days * 24 * 60 * 60 * 1000;
    return this.list(userId).filter((i) => {
      const t = new Date(i.startsAt).getTime();
      return t >= now.getTime() && t <= horizon;
    });
  }
}
