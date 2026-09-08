import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ApprovalActionClass,
  ApprovalPolicyRecord,
  ApprovalRequestRecord,
  ApprovalScope,
  ApprovalStatus,
  FinancialApprovalPolicy,
} from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS approval_policies (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  scope          TEXT NOT NULL DEFAULT 'global',
  chat_id        TEXT,
  financial_json TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  action       TEXT NOT NULL,
  action_class TEXT NOT NULL,
  target       TEXT,
  args_json    TEXT,
  scope        TEXT NOT NULL DEFAULT 'ONCE',
  status       TEXT NOT NULL DEFAULT 'pending',
  expires_at   TEXT,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_policies_user ON approval_policies(user_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_user ON approval_requests(user_id, status);
`;

interface PolicyRow {
  id: string;
  user_id: string;
  scope: string;
  chat_id: string | null;
  financial_json: string | null;
  created_at: string;
  updated_at: string;
}

interface RequestRow {
  id: string;
  user_id: string;
  session_id: string;
  action: string;
  action_class: string;
  target: string | null;
  args_json: string | null;
  scope: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface SetPolicyInput {
  userId: string;
  scope: "global" | "chat";
  chatId?: string;
  financial: FinancialApprovalPolicy;
}

export interface CreateRequestInput {
  userId: string;
  sessionId: string;
  action: string;
  actionClass: ApprovalActionClass;
  target?: string;
  args?: Record<string, unknown>;
  scope?: ApprovalScope;
  expiresAt?: string;
}

function rowToPolicy(row: PolicyRow): ApprovalPolicyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as "global" | "chat",
    chatId: row.chat_id ?? undefined,
    financial: row.financial_json
      ? (JSON.parse(row.financial_json) as FinancialApprovalPolicy)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRequest(row: RequestRow): ApprovalRequestRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    action: row.action,
    actionClass: row.action_class as ApprovalActionClass,
    target: row.target ?? undefined,
    args: row.args_json ? (JSON.parse(row.args_json) as Record<string, unknown>) : undefined,
    scope: row.scope as ApprovalScope,
    status: row.status as ApprovalStatus,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

/**
 * Deterministic SQLite store for approval policies and pending approvals.
 * Approval is scoped to user (+ chat for Telegram) and bound to a concrete
 * action, its arguments, target and the originating session — one approval
 * never covers a different action.
 */
export class ApprovalService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("ApprovalService not initialized — call init() first");
    return this.db;
  }

  init(): void {
    if (this.db) this.db.close();
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Add scope column onto older approval DBs. */
  private migrate(): void {
    const db = this.requireDb();
    const columns = new Set(
      (db.pragma("table_info(approval_requests)") as Array<{ name: string }>).map((c) => c.name),
    );
    if (!columns.has("scope")) {
      db.exec(`ALTER TABLE approval_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'ONCE'`);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Chat-scoped policy takes precedence over the user's global policy. */
  getPolicy(userId: string, chatId?: string): FinancialApprovalPolicy | undefined {
    const db = this.requireDb();
    const rows = db
      .prepare(`SELECT * FROM approval_policies WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as PolicyRow[];
    const chat = rows.find((r) => r.scope === "chat" && r.chat_id === chatId);
    const chosen = chat ?? rows.find((r) => r.scope === "global");
    return chosen ? rowToPolicy(chosen).financial : undefined;
  }

  setPolicy(input: SetPolicyInput): ApprovalPolicyRecord {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const existing = db
      .prepare(
        `SELECT id FROM approval_policies WHERE user_id = ? AND scope = ? AND chat_id IS ?`,
      )
      .get(input.userId, input.scope, input.chatId ?? null) as { id: string } | undefined;

    const id = existing?.id ?? randomUUID();
    db.prepare(
      `INSERT INTO approval_policies (id, user_id, scope, chat_id, financial_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET financial_json = excluded.financial_json, updated_at = excluded.updated_at`,
    ).run(
      id,
      input.userId,
      input.scope,
      input.chatId ?? null,
      JSON.stringify(input.financial),
      now,
      now,
    );

    const row = db.prepare(`SELECT * FROM approval_policies WHERE id = ?`).get(id) as PolicyRow;
    return rowToPolicy(row);
  }

  createRequest(input: CreateRequestInput): ApprovalRequestRecord {
    const db = this.requireDb();
    const record: ApprovalRequestRecord = {
      id: randomUUID(),
      userId: input.userId,
      sessionId: input.sessionId,
      action: input.action,
      actionClass: input.actionClass,
      target: input.target,
      args: input.args,
      scope: input.scope ?? "ONCE",
      status: "pending",
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO approval_requests
       (id, user_id, session_id, action, action_class, target, args_json, scope, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.userId,
      record.sessionId,
      record.action,
      record.actionClass,
      record.target ?? null,
      record.args ? JSON.stringify(record.args) : null,
      record.scope,
      record.status,
      record.expiresAt ?? null,
      record.createdAt,
    );
    return record;
  }

  get(id: string): ApprovalRequestRecord | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id) as
      | RequestRow
      | undefined;
    return row ? rowToRequest(row) : undefined;
  }

  listPending(userId: string): ApprovalRequestRecord[] {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM approval_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC`)
      .all(userId) as RequestRow[];
    return rows.map(rowToRequest);
  }

  /** Returns false when the request is already resolved or expired. */
  grant(id: string): boolean {
    return this.resolve(id, "approved");
  }

  deny(id: string): boolean {
    return this.resolve(id, "rejected");
  }

  cancel(id: string): boolean {
    return this.resolve(id, "cancelled");
  }

  private resolve(id: string, status: "approved" | "rejected" | "cancelled"): boolean {
    const db = this.requireDb();
    const result = db
      .prepare(
        `UPDATE approval_requests SET status = ?, resolved_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Expire stale pending requests (no active expiry scheduler — called on demand). */
  expireOverdue(now: Date = new Date()): number {
    const db = this.requireDb();
    const result = db
      .prepare(
        `UPDATE approval_requests SET status = 'expired', resolved_at = ?
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(now.toISOString(), now.toISOString());
    return result.changes;
  }
}
