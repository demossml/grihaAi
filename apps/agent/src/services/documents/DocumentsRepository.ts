/**
 * DocumentsRepository — SQLite store для чеков/накладных.
 * Файл: ~/.grish-ai/documents.sqlite (отдельный от memory — не ломает миграции).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ExpenseDocument, ExpensesQuery, ExpensesQueryResult } from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS expense_documents (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  from_user_id TEXT,
  file_id TEXT,
  file_unique_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  kind TEXT NOT NULL DEFAULT 'unknown',
  doc_date TEXT NOT NULL,
  supplier TEXT,
  total REAL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  raw_text TEXT,
  items_json TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'telegram',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_chat_date
  ON expense_documents(chat_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_expense_supplier
  ON expense_documents(supplier);
CREATE INDEX IF NOT EXISTS idx_expense_file_unique
  ON expense_documents(file_unique_id);
`;

interface DocRow {
  id: string;
  chat_id: string;
  message_id: string | null;
  from_user_id: string | null;
  file_id: string | null;
  file_unique_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  kind: string;
  doc_date: string;
  supplier: string | null;
  total: number | null;
  currency: string;
  raw_text: string | null;
  items_json: string | null;
  confidence: number;
  needs_review: number;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToDoc(row: DocRow): ExpenseDocument {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id ?? undefined,
    fromUserId: row.from_user_id ?? undefined,
    fileId: row.file_id ?? undefined,
    fileUniqueId: row.file_unique_id ?? undefined,
    fileName: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    kind: row.kind as ExpenseDocument["kind"],
    docDate: row.doc_date,
    supplier: row.supplier ?? undefined,
    total: row.total ?? undefined,
    currency: row.currency,
    rawText: row.raw_text ?? undefined,
    itemsJson: row.items_json ?? undefined,
    confidence: row.confidence,
    needsReview: row.needs_review !== 0,
    source: row.source as ExpenseDocument["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DocumentsRepository {
  private db: Database.Database;

  constructor(private readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /** Вставка с дедупом: тот же file_unique_id + chat_id → вернуть existing. */
  async insert(doc: ExpenseDocument): Promise<ExpenseDocument> {
    if (doc.fileUniqueId) {
      const existing = await this.findByFileUniqueId(doc.chatId, doc.fileUniqueId);
      if (existing) return existing;
    }
    const id = doc.id || randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO expense_documents
         (id, chat_id, message_id, from_user_id, file_id, file_unique_id, file_name, mime_type,
          kind, doc_date, supplier, total, currency, raw_text, items_json,
          confidence, needs_review, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        doc.chatId,
        doc.messageId ?? null,
        doc.fromUserId ?? null,
        doc.fileId ?? null,
        doc.fileUniqueId ?? null,
        doc.fileName ?? null,
        doc.mimeType ?? null,
        doc.kind,
        doc.docDate,
        doc.supplier ?? null,
        doc.total ?? null,
        doc.currency || "RUB",
        doc.rawText ?? null,
        doc.itemsJson ?? null,
        doc.confidence,
        doc.needsReview ? 1 : 0,
        doc.source,
        now,
        now,
      );
    return (await this.getById(id))!;
  }

  async findByFileUniqueId(chatId: string, fileUniqueId: string): Promise<ExpenseDocument | null> {
    const row = this.db
      .prepare(`SELECT * FROM expense_documents WHERE chat_id = ? AND file_unique_id = ?`)
      .get(chatId, fileUniqueId) as DocRow | undefined;
    return row ? rowToDoc(row) : null;
  }

  async getById(id: string): Promise<ExpenseDocument | null> {
    const row = this.db.prepare(`SELECT * FROM expense_documents WHERE id = ?`).get(id) as
      | DocRow
      | undefined;
    return row ? rowToDoc(row) : null;
  }

  /**
   * Полная история по умолчанию: fromDate/toDate фильтруют только если заданы.
   */
  async query(q: ExpensesQuery): Promise<ExpensesQueryResult> {
    const chatId = q.chatId;
    if (!chatId) {
      return {
        ok: true,
        count: 0,
        totalSum: 0,
        currency: "RUB",
        fullHistory: !q.fromDate && !q.toDate,
        documents: [],
      };
    }
    const fromDate = q.fromDate ?? null;
    const toDate = q.toDate ?? null;
    const supplierNeedle = q.supplier?.trim() ? q.supplier.trim().toLowerCase() : null;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);

    // supplier-фильтр — в JS: sqlite lower() не умеет кириллицу.
    const rows = this.db
      .prepare(
        `SELECT * FROM expense_documents
         WHERE chat_id = ?
           AND (? IS NULL OR doc_date >= ?)
           AND (? IS NULL OR doc_date <= ?)
         ORDER BY doc_date DESC, created_at DESC
         LIMIT ?`,
      )
      .all(chatId, fromDate, fromDate, toDate, toDate, limit) as DocRow[];

    const docs = rows
      .map(rowToDoc)
      .filter((d) =>
        supplierNeedle ? (d.supplier ?? "").toLowerCase().includes(supplierNeedle) : true,
      );
    const withTotal = docs.filter((d) => d.total !== undefined);
    const totalSum = withTotal.reduce((acc, d) => acc + (d.total ?? 0), 0);

    const currencies = new Set(withTotal.map((d) => d.currency || "RUB"));
    const currency = currencies.size === 1 ? [...currencies][0] : "RUB";
    const note = currencies.size > 1 ? "mixed currencies" : undefined;

    return {
      ok: true,
      count: docs.length,
      totalSum,
      currency,
      fullHistory: !q.fromDate && !q.toDate,
      documents: docs.map((d) => ({
        id: d.id,
        docDate: d.docDate,
        supplier: d.supplier,
        total: d.total,
        currency: d.currency,
        needsReview: d.needsReview,
        fileName: d.fileName,
      })),
      note,
    };
  }
}
