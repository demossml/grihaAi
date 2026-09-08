import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ClientNote } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS client_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS client_notes_fts USING fts5(content, content='client_notes', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS client_notes_ai AFTER INSERT ON client_notes BEGIN
  INSERT INTO client_notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS client_notes_ad AFTER DELETE ON client_notes BEGIN
  INSERT INTO client_notes_fts(client_notes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS client_notes_au AFTER UPDATE ON client_notes BEGIN
  INSERT INTO client_notes_fts(client_notes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO client_notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_client_notes_user ON client_notes(user_id);
`;

interface NoteRow {
  id: string;
  user_id: string;
  content: string;
  category: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

export class ClientNotesService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("ClientNotesService not initialized — call init() first");
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

  async addNote(note: Omit<ClientNote, "id" | "createdAt" | "updatedAt">): Promise<ClientNote> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    const row: NoteRow = {
      id,
      user_id: note.userId,
      content: note.content,
      category: note.category,
      source: note.source ?? null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO client_notes (id, user_id, content, category, source, created_at, updated_at)
       VALUES (@id, @user_id, @content, @category, @source, @created_at, @updated_at)`,
    ).run(row);
    return this.rowToNote(row);
  }

  async listNotes(userId: string): Promise<ClientNote[]> {
    const db = this.requireDb();
    const rows = db
      .prepare(`SELECT * FROM client_notes WHERE user_id = ? ORDER BY updated_at DESC`)
      .all(userId) as NoteRow[];
    return rows.map((r) => this.rowToNote(r));
  }

  async searchNotes(userId: string, query: string): Promise<ClientNote[]> {
    const db = this.requireDb();
    const limit = 20;
    let rows: NoteRow[] = [];

    const fts = buildFtsQuery(query);
    if (fts) {
      try {
        rows = db
          .prepare(
            `SELECT n.* FROM client_notes_fts
             JOIN client_notes n ON n.rowid = client_notes_fts.rowid
             WHERE client_notes_fts MATCH ? AND n.user_id = ?
             ORDER BY n.updated_at DESC LIMIT ?`,
          )
          .all(fts, userId, limit) as NoteRow[];
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      rows = db
        .prepare(`SELECT * FROM client_notes WHERE user_id = ? AND content LIKE ? ORDER BY updated_at DESC LIMIT ?`)
        .all(userId, `%${query}%`, limit) as NoteRow[];
    }

    return rows.map((r) => this.rowToNote(r));
  }

  async deleteNote(id: string): Promise<void> {
    const db = this.requireDb();
    db.prepare(`DELETE FROM client_notes WHERE id = ?`).run(id);
  }

  private rowToNote(row: NoteRow): ClientNote {
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      category: row.category as ClientNote["category"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: (row.source ?? undefined) as ClientNote["source"],
    };
  }
}
