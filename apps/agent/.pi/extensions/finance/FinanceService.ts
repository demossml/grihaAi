import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Expense, Invoice, InvoiceStatus } from "../../../src/types/index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS expenses (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  date           TEXT NOT NULL,
  vendor         TEXT NOT NULL,
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL,
  category       TEXT,
  payment_method TEXT,
  document_id    TEXT,
  confidence     REAL NOT NULL DEFAULT 1,
  source         TEXT NOT NULL DEFAULT 'manual',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  number     TEXT NOT NULL,
  vendor     TEXT,
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL,
  due_date   TEXT,
  status     TEXT NOT NULL DEFAULT 'draft',
  contact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status);
`;

interface ExpenseRow {
  id: string;
  user_id: string;
  date: string;
  vendor: string;
  amount: number;
  currency: string;
  category: string | null;
  payment_method: string | null;
  document_id: string | null;
  confidence: number;
  source: string;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  user_id: string;
  number: string;
  vendor: string | null;
  amount: number;
  currency: string;
  due_date: string | null;
  status: string;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseAddInput {
  userId: string;
  date: string;
  vendor: string;
  amount: number;
  currency: string;
  category?: string;
  paymentMethod?: string;
  documentId?: string;
  confidence?: number;
  source?: Expense["source"];
}

export interface InvoiceAddInput {
  userId: string;
  number: string;
  vendor?: string;
  amount: number;
  currency: string;
  dueDate?: string;
  contactId?: string;
}

const TERMINAL_INVOICE: Set<InvoiceStatus> = new Set(["paid", "cancelled"]);

function rowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    vendor: row.vendor,
    amount: row.amount,
    currency: row.currency,
    category: row.category ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    documentId: row.document_id ?? undefined,
    confidence: row.confidence,
    source: row.source as Expense["source"],
    createdAt: row.created_at,
  };
}

function rowToInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    userId: row.user_id,
    number: row.number,
    vendor: row.vendor ?? undefined,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.due_date ?? undefined,
    status: row.status as InvoiceStatus,
    contactId: row.contact_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Derive due/overdue from the due date (terminal statuses are sticky). */
export function deriveInvoiceStatus(current: InvoiceStatus, dueDate: string | undefined, now: Date): InvoiceStatus {
  if (TERMINAL_INVOICE.has(current)) return current;
  if (!dueDate || current === "draft") return current;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return current;
  if (due <= now.getTime()) return "overdue";
  return "sent";
}

/** Deterministic SQLite store for expenses and invoices. */
export class FinanceService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("FinanceService not initialized — call init() first");
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

  addExpense(input: ExpenseAddInput): Expense {
    const db = this.requireDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO expenses
       (id, user_id, date, vendor, amount, currency, category, payment_method, document_id, confidence, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      input.date,
      input.vendor,
      input.amount,
      input.currency,
      input.category ?? null,
      input.paymentMethod ?? null,
      input.documentId ?? null,
      input.confidence ?? 1,
      input.source ?? "manual",
      new Date().toISOString(),
    );
    return this.getExpense(id)!;
  }

  getExpense(id: string): Expense | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as
      | ExpenseRow
      | undefined;
    return row ? rowToExpense(row) : undefined;
  }

  listExpenses(userId: string, options?: { from?: string; to?: string; category?: string }): Expense[] {
    const db = this.requireDb();
    let sql = `SELECT * FROM expenses WHERE user_id = ?`;
    const params: unknown[] = [userId];
    if (options?.from) {
      sql += ` AND date >= ?`;
      params.push(options.from);
    }
    if (options?.to) {
      sql += ` AND date <= ?`;
      params.push(options.to);
    }
    if (options?.category) {
      sql += ` AND category = ?`;
      params.push(options.category);
    }
    sql += ` ORDER BY date ASC`;
    return (db.prepare(sql).all(...params) as ExpenseRow[]).map(rowToExpense);
  }

  /** Vendor→category history from past confirmed expenses (for categorization). */
  vendorHistory(userId: string): Array<{ vendor: string; category: string }> {
    const rows = this.requireDb()
      .prepare(`SELECT DISTINCT vendor, category FROM expenses WHERE user_id = ? AND category IS NOT NULL`)
      .all(userId) as Array<{ vendor: string; category: string }>;
    return rows;
  }

  addInvoice(input: InvoiceAddInput): Invoice {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    const status = deriveInvoiceStatus("draft", input.dueDate, new Date());
    db.prepare(
      `INSERT INTO invoices (id, user_id, number, vendor, amount, currency, due_date, status, contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      input.number,
      input.vendor ?? null,
      input.amount,
      input.currency,
      input.dueDate ?? null,
      status,
      input.contactId ?? null,
      now,
      now,
    );
    return this.getInvoice(id)!;
  }

  getInvoice(id: string): Invoice | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM invoices WHERE id = ?`).get(id) as
      | InvoiceRow
      | undefined;
    return row ? rowToInvoice(row) : undefined;
  }

  listInvoices(userId: string, options?: { status?: InvoiceStatus }): Invoice[] {
    const db = this.requireDb();
    const rows = options?.status
      ? (db
          .prepare(`SELECT * FROM invoices WHERE user_id = ? AND status = ? ORDER BY created_at ASC`)
          .all(userId, options.status) as InvoiceRow[])
      : (db
          .prepare(`SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at ASC`)
          .all(userId) as InvoiceRow[]);
    return rows.map(rowToInvoice);
  }

  setInvoiceStatus(id: string, status: InvoiceStatus): Invoice | undefined {
    const db = this.requireDb();
    const existing = this.getInvoice(id);
    if (!existing) return undefined;
    db.prepare(`UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?`).run(
      status,
      new Date().toISOString(),
      id,
    );
    return this.getInvoice(id);
  }

  /** Re-derive due/overdue for non-terminal invoices. Returns count changed. */
  refreshInvoiceStatuses(now: Date = new Date()): number {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM invoices`).all() as InvoiceRow[];
    let changed = 0;
    for (const row of rows) {
      const current = row.status as InvoiceStatus;
      const next = deriveInvoiceStatus(current, row.due_date ?? undefined, now);
      if (next !== current) {
        db.prepare(`UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?`).run(
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
