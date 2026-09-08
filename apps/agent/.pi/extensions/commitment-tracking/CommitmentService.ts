import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Commitment, CommitmentStatus } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commitments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  who         TEXT,
  to_whom     TEXT,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  source_type TEXT,
  source_id   TEXT,
  contact_id  TEXT,
  meeting_id  TEXT,
  confidence  REAL NOT NULL DEFAULT 1,
  provenance  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_user_status ON commitments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(due_date);
`;

/** Columns added by the domain contract (migrated onto older DBs). */
const NEW_COLUMNS: Array<[name: string, ddl: string]> = [
  ["actor", "TEXT"],
  ["action", "TEXT"],
  ["target", "TEXT"],
  ["deadline", "TEXT"],
  ["source", "TEXT"],
  ["source_message_id", "TEXT"],
  ["completed_at", "TEXT"],
];

interface CommitmentRow {
  id: string;
  user_id: string;
  text: string;
  who: string | null;
  to_whom: string | null;
  due_date: string | null;
  status: string;
  source_type: string | null;
  source_id: string | null;
  contact_id: string | null;
  meeting_id: string | null;
  confidence: number;
  provenance: string | null;
  created_at: string;
  updated_at: string;
  actor?: string | null;
  action?: string | null;
  target?: string | null;
  deadline?: string | null;
  source?: string | null;
  source_message_id?: string | null;
  completed_at?: string | null;
}

export interface CommitmentAddInput {
  userId: string;
  text: string;
  who?: string;
  toWhom?: string;
  dueDate?: string;
  actor?: string;
  action?: string;
  target?: string;
  deadline?: string;
  source?: string;
  sourceMessageId?: string;
  confidence?: number;
  sourceType?: Commitment["sourceType"];
  sourceId?: string;
  contactId?: string;
  meetingId?: string;
  provenance?: string;
}

export interface CommitmentUpdatePatch {
  text?: string;
  status?: CommitmentStatus;
  dueDate?: string;
  completedAt?: string;
}

const TERMINAL: Set<CommitmentStatus> = new Set(["completed", "cancelled"]);

/** Time window (ms) inside which an open commitment counts as due_soon. */
export const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Pure status derivation: terminal statuses are sticky; otherwise derive from
 * the due date. Exported for unit tests.
 */
export function deriveStatus(
  current: CommitmentStatus,
  dueDate: string | undefined,
  now: Date = new Date(),
): CommitmentStatus {
  if (TERMINAL.has(current)) return current;
  if (!dueDate) return "open";
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return "open";
  if (due <= now.getTime()) return "overdue";
  if (due <= now.getTime() + DUE_SOON_WINDOW_MS) return "due_soon";
  return "open";
}

function rowToCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    action: row.action ?? row.text,
    who: row.who ?? undefined,
    actor: row.actor ?? row.who ?? undefined,
    toWhom: row.to_whom ?? undefined,
    target: row.target ?? row.to_whom ?? undefined,
    dueDate: row.due_date ?? undefined,
    deadline: row.deadline ?? row.due_date ?? undefined,
    status: row.status as CommitmentStatus,
    sourceType: (row.source_type ?? undefined) as Commitment["sourceType"],
    source: row.source ?? row.source_type ?? undefined,
    sourceId: row.source_id ?? undefined,
    sourceMessageId: row.source_message_id ?? row.source_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    meetingId: row.meeting_id ?? undefined,
    confidence: row.confidence,
    provenance: row.provenance ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deterministic SQLite store for commitments ("who owes what, to whom, by when").
 * Statuses due_soon/overdue are derived from the due date, never stored by hand.
 */
export class CommitmentService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("CommitmentService not initialized — call init() first");
    return this.db;
  }

  init(): void {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Add missing domain-contract columns onto databases created before the contract. */
  private migrate(): void {
    const db = this.requireDb();
    const existing = new Set(
      (db.pragma("table_info(commitments)") as Array<{ name: string }>).map((c) => c.name),
    );
    for (const [name, ddl] of NEW_COLUMNS) {
      if (!existing.has(name)) {
        db.exec(`ALTER TABLE commitments ADD COLUMN ${name} ${ddl}`);
      }
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  add(input: CommitmentAddInput): Commitment {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    // Domain contract aliases: canonical fields fall back to legacy fields.
    const text = input.text || input.action || "";
    const action = input.action ?? input.text;
    const who = input.who ?? input.actor;
    const actor = input.actor ?? input.who;
    const toWhom = input.toWhom ?? input.target;
    const target = input.target ?? input.toWhom;
    const dueDate = input.dueDate ?? input.deadline;
    const deadline = input.deadline ?? input.dueDate;
    const sourceMessageId =
      input.sourceMessageId ?? (input.sourceType === "message" ? input.sourceId : undefined);

    const status = deriveStatus("open", dueDate);
    db.prepare(
      `INSERT INTO commitments
       (id, user_id, text, who, to_whom, due_date, status, source_type, source_id,
        contact_id, meeting_id, confidence, provenance, created_at, updated_at,
        actor, action, target, deadline, source, source_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      text,
      who ?? null,
      toWhom ?? null,
      dueDate ?? null,
      status,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.contactId ?? null,
      input.meetingId ?? null,
      input.confidence ?? 1,
      input.provenance ?? null,
      now,
      now,
      actor ?? null,
      action ?? null,
      target ?? null,
      deadline ?? null,
      input.source ?? input.sourceType ?? null,
      sourceMessageId ?? null,
    );
    return this.get(id)!;
  }

  get(id: string): Commitment | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM commitments WHERE id = ?`).get(id) as
      | CommitmentRow
      | undefined;
    return row ? rowToCommitment(row) : undefined;
  }

  list(userId: string, options?: { status?: CommitmentStatus; limit?: number }): Commitment[] {
    const db = this.requireDb();
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const rows = options?.status
      ? (db
          .prepare(`SELECT * FROM commitments WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`)
          .all(userId, options.status, limit) as CommitmentRow[])
      : (db
          .prepare(`SELECT * FROM commitments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(userId, limit) as CommitmentRow[]);
    return rows.map(rowToCommitment);
  }

  /** Commitments that will become due within the window (not yet overdue). */
  dueSoon(userId: string, now: Date = new Date()): Commitment[] {
    this.refreshStatuses(now);
    return this.list(userId, { limit: 100 }).filter((c) => c.status === "due_soon");
  }

  /** Commitments past their deadline. */
  overdue(userId: string, now: Date = new Date()): Commitment[] {
    this.refreshStatuses(now);
    return this.list(userId, { limit: 100 }).filter((c) => c.status === "overdue");
  }

  update(id: string, patch: CommitmentUpdatePatch): Commitment | undefined {
    const db = this.requireDb();
    const existing = this.get(id);
    if (!existing) return undefined;

    const dueDate = patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
    const status = patch.status ?? deriveStatus(existing.status, dueDate);
    const text = patch.text ?? existing.text;
    const completedAt =
      status === "completed" && !TERMINAL.has(existing.status)
        ? patch.completedAt ?? new Date().toISOString()
        : existing.completedAt;

    db.prepare(
      `UPDATE commitments SET text = ?, action = COALESCE(action, ?), status = ?, due_date = ?, deadline = COALESCE(deadline, ?), completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(text, text, status, dueDate ?? null, dueDate ?? null, completedAt ?? null, new Date().toISOString(), id);
    return this.get(id);
  }

  /** Re-derive due_soon/overdue for every non-terminal commitment. Returns count changed. */
  refreshStatuses(now: Date = new Date()): number {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM commitments`).all() as CommitmentRow[];
    let changed = 0;
    for (const row of rows) {
      const current = row.status as CommitmentStatus;
      const next = deriveStatus(current, row.due_date ?? undefined, now);
      if (next !== current) {
        db.prepare(`UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?`).run(
          next,
          now.toISOString(),
          row.id,
        );
        changed++;
      }
    }
    return changed;
  }
}
