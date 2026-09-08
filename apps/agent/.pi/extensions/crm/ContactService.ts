import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Contact } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS contacts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  name                TEXT NOT NULL,
  tags                TEXT NOT NULL DEFAULT '[]',
  last_interaction_at TEXT,
  provenance          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_name ON contacts(user_id, name COLLATE NOCASE);
`;

interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  tags: string;
  last_interaction_at: string | null;
  provenance: string | null;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tags: JSON.parse(row.tags) as string[],
    lastInteractionAt: row.last_interaction_at ?? undefined,
    provenance: row.provenance ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Structured client identity (CRM-lite): identity, tags, last interaction and
 * provenance. Client *notes* live in ClientNotesService (sqlite-rag-memory);
 * this service only holds the identity metadata so the two do not duplicate.
 */
export class ContactService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("ContactService not initialized — call init() first");
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

  upsert(userId: string, name: string, tags: string[] = [], provenance?: string): Contact {
    const db = this.requireDb();
    const now = new Date().toISOString();
    // Case-insensitive dedupe must be Unicode-aware (SQLite NOCASE is ASCII-only,
    // so Cyrillic names need a JS comparison).
    const rows = db.prepare(`SELECT * FROM contacts WHERE user_id = ?`).all(userId) as ContactRow[];
    const existing = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());

    if (existing) {
      db.prepare(
        `UPDATE contacts SET name = ?, tags = ?, provenance = COALESCE(?, provenance), updated_at = ? WHERE id = ?`,
      ).run(name, JSON.stringify(tags), provenance ?? null, now, existing.id);
      return this.get(existing.id)!;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO contacts (id, user_id, name, tags, provenance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, name, JSON.stringify(tags), provenance ?? null, now, now);
    return this.get(id)!;
  }

  get(id: string): Contact | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as
      | ContactRow
      | undefined;
    return row ? rowToContact(row) : undefined;
  }

  list(userId: string): Contact[] {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM contacts WHERE user_id = ? ORDER BY name ASC`)
      .all(userId) as ContactRow[];
    return rows.map(rowToContact);
  }

  /** Record an interaction, updating last_interaction_at. */
  touch(id: string): Contact | undefined {
    const db = this.requireDb();
    const existing = this.get(id);
    if (!existing) return undefined;
    db.prepare(`UPDATE contacts SET last_interaction_at = ?, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    );
    return this.get(id);
  }
}
