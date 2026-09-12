/**
 * DocumentsRepository — SQLite store для чеков/накладных.
 * Файл: ~/.grish-ai/documents.sqlite (отдельный от memory — не ломает миграции).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ExpenseDocument, ExpensesQuery, ExpensesQueryResult } from "./types.js";
import type { ChatArchiveRecord } from "./chat-archive.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS expense_documents (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
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
  updated_at TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  line_items TEXT,
  attrs TEXT
);

CREATE INDEX IF NOT EXISTS idx_expense_chat_date
  ON expense_documents(chat_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_expense_supplier
  ON expense_documents(supplier);
CREATE INDEX IF NOT EXISTS idx_expense_file_unique
  ON expense_documents(file_unique_id);

CREATE TABLE IF NOT EXISTS chat_archive (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  from_user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'text',
  doc_date TEXT,
  supplier TEXT,
  total REAL,
  currency TEXT,
  raw_text TEXT,
  file_id TEXT,
  file_unique_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  items_json TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_chat_msg
  ON chat_archive(chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_archive_chat_file
  ON chat_archive(chat_id, file_unique_id);
CREATE INDEX IF NOT EXISTS idx_archive_chat_date
  ON chat_archive(chat_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_media (
  id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  thread_id TEXT,
  file_unique_id TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  file_name TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  caption TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chat_id, message_id, file_unique_id)
);

CREATE INDEX IF NOT EXISTS idx_media_chat_unique
  ON telegram_media(chat_id, file_unique_id);
CREATE INDEX IF NOT EXISTS idx_media_status_updated
  ON telegram_media(processing_status, updated_at);

CREATE TABLE IF NOT EXISTS expense_learning (
  id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chat_id, pattern_type, pattern)
);
`;

/** Миграция форумных тем (ADD COLUMN thread_id). */
const THREAD_MIGRATION_SQL = `
ALTER TABLE expense_documents ADD COLUMN thread_id TEXT;
CREATE INDEX IF NOT EXISTS idx_expense_chat_thread_date
  ON expense_documents(chat_id, thread_id, doc_date);
`;

interface DocRow {
  id: string;
  chat_id: string;
  thread_id: string | null;
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
  category: string | null;
  tags: string | null;
  line_items: string | null;
  attrs: string | null;
}

interface ArchiveRow {
  id: string;
  chat_id: string;
  thread_id: string | null;
  message_id: string | null;
  from_user_id: string | null;
  kind: string;
  doc_date: string | null;
  supplier: string | null;
  total: number | null;
  currency: string | null;
  raw_text: string | null;
  file_id: string | null;
  file_unique_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  items_json: string | null;
  confidence: number;
  needs_review: number;
  created_at: string;
  ocr_status: string | null;
  expense_id: string | null;
  is_edited: number;
  revision: number;
  caption: string | null;
  storage_key?: string | null;
}

/** State machine обработки медиа (PROMPT 07). */
export type MediaProcessingStatus =
  | "received"
  | "downloading"
  | "stored"
  | "processing"
  | "processed"
  | "failed"
  | "dead_letter";

export interface TelegramMediaRecord {
  id: number;
  chatId: string;
  messageId: number;
  threadId?: string;
  fileUniqueId: string;
  telegramFileId: string;
  storageKey: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  caption?: string;
  processingStatus: MediaProcessingStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface MediaRow {
  id: number;
  chat_id: string;
  message_id: number;
  thread_id: string | null;
  file_unique_id: string;
  telegram_file_id: string;
  storage_key: string;
  mime_type: string | null;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  caption: string | null;
  processing_status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mediaRowToRecord(row: MediaRow): TelegramMediaRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    threadId: row.thread_id ?? undefined,
    fileUniqueId: row.file_unique_id,
    telegramFileId: row.telegram_file_id,
    storageKey: row.storage_key,
    mimeType: row.mime_type ?? undefined,
    fileName: row.file_name ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    caption: row.caption ?? undefined,
    processingStatus: row.processing_status as MediaProcessingStatus,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function archiveRowToRecord(row: ArchiveRow): ChatArchiveRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    threadId: row.thread_id ?? undefined,
    messageId: row.message_id ?? undefined,
    fromUserId: row.from_user_id ?? undefined,
    kind: row.kind as ChatArchiveRecord["kind"],
    docDate: row.doc_date ?? undefined,
    supplier: row.supplier ?? undefined,
    total: row.total ?? undefined,
    currency: row.currency ?? undefined,
    rawText: row.raw_text ?? undefined,
    fileId: row.file_id ?? undefined,
    fileUniqueId: row.file_unique_id ?? undefined,
    fileName: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    itemsJson: row.items_json ?? undefined,
    confidence: row.confidence,
    needsReview: row.needs_review !== 0,
    createdAt: row.created_at,
    ocrStatus: (row.ocr_status ?? undefined) as ChatArchiveRecord["ocrStatus"],
    expenseId: row.expense_id ?? undefined,
    isEdited: row.is_edited !== 0,
    revision: row.revision,
    caption: row.caption ?? undefined,
    storageKey: row.storage_key ?? undefined,
  };
}

/** Запрос истории группы (H5: limit уже заклэмплен вызывающим). */
export interface ArchiveListQuery {
  chatId: string;
  threadId?: string;
  limit: number;
  beforeMessageId?: string;
  kinds?: string[];
  fromDate?: string;
  toDate?: string;
}

function rowToDoc(row: DocRow): ExpenseDocument {
  return {
    id: row.id,
    chatId: row.chat_id,
    threadId: row.thread_id ?? undefined,
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
    category: row.category ?? undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    lineItems: row.line_items
      ? (JSON.parse(row.line_items) as ExpenseDocument["lineItems"])
      : undefined,
    attrs: row.attrs
      ? (JSON.parse(row.attrs) as ExpenseDocument["attrs"])
      : undefined,
  };
}

export class DocumentsRepository {
  private db: Database.Database;

  constructor(private readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    // Миграция: forum topics (thread_id) для баз документов MVP.
    const columns = new Set(
      (this.db.pragma("table_info(expense_documents)") as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!columns.has("thread_id")) {
      this.db.exec(THREAD_MIGRATION_SQL);
    } else {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_expense_chat_thread_date
         ON expense_documents(chat_id, thread_id, doc_date);`,
      );
    }
    // Listen-only OCR: additive-колонки архива (ocr_status/expense_id).
    const archiveColumns = new Set(
      (this.db.pragma("table_info(chat_archive)") as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!archiveColumns.has("ocr_status")) {
      this.db.exec("ALTER TABLE chat_archive ADD COLUMN ocr_status TEXT;");
    }
    if (!archiveColumns.has("expense_id")) {
      this.db.exec("ALTER TABLE chat_archive ADD COLUMN expense_id TEXT;");
    }
    // PROMPT 02: ревизии правок (edited_message/edited_channel_post).
    if (!archiveColumns.has("is_edited")) {
      this.db.exec("ALTER TABLE chat_archive ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0;");
    }
    if (!archiveColumns.has("revision")) {
      this.db.exec("ALTER TABLE chat_archive ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;");
    }
    // PROMPT 04: caption хранится отдельно от OCR/STT-текста.
    if (!archiveColumns.has("caption")) {
      this.db.exec("ALTER TABLE chat_archive ADD COLUMN caption TEXT;");
    }
    // F1/F3/F6: гибкие поля расходов (additive, nullable) — старые БД открываются.
    const expenseColumns = new Set(
      (this.db.pragma("table_info(expense_documents)") as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!expenseColumns.has("category")) {
      this.db.exec("ALTER TABLE expense_documents ADD COLUMN category TEXT;");
    }
    if (!expenseColumns.has("tags")) {
      this.db.exec("ALTER TABLE expense_documents ADD COLUMN tags TEXT;");
    }
    if (!expenseColumns.has("line_items")) {
      this.db.exec("ALTER TABLE expense_documents ADD COLUMN line_items TEXT;");
    }
    if (!expenseColumns.has("attrs")) {
      this.db.exec("ALTER TABLE expense_documents ADD COLUMN attrs TEXT;");
    }
  }

  close(): void {
    this.db.close();
  }

  /**
   * Вставка с дедупом: тот же file_unique_id + chat_id → вернуть existing.
   * Атомарно (транзакция) — повторная доставка Telegram не создаёт дубль (PROMPT 07).
   */
  async insert(doc: ExpenseDocument): Promise<ExpenseDocument> {
    if (doc.fileUniqueId) {
      const existing = await this.findByFileUniqueId(doc.chatId, doc.fileUniqueId);
      if (existing) return existing;
    }
    const id = doc.id || randomUUID();
    const now = new Date().toISOString();
    const runInsert = this.db.transaction((): string => {
      if (doc.fileUniqueId) {
        const inside = this.db
          .prepare(`SELECT id FROM expense_documents WHERE chat_id = ? AND file_unique_id = ?`)
          .get(doc.chatId, doc.fileUniqueId) as { id: string } | undefined;
        if (inside) return inside.id;
      }
      this.db
        .prepare(
          `INSERT INTO expense_documents
           (id, chat_id, thread_id, message_id, from_user_id, file_id, file_unique_id, file_name, mime_type,
            kind, doc_date, supplier, total, currency, raw_text, items_json,
            confidence, needs_review, source, created_at, updated_at,
            category, tags, line_items, attrs)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          doc.chatId,
          doc.threadId ?? null,
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
          doc.category ?? null,
          doc.tags?.length ? JSON.stringify(doc.tags) : null,
          doc.lineItems?.length ? JSON.stringify(doc.lineItems) : null,
          doc.attrs ? JSON.stringify(doc.attrs) : null,
        );
      return id;
    });
    const insertedId = runInsert();
    return (await this.getById(insertedId))!;
  }

  async findByFileUniqueId(chatId: string, fileUniqueId: string): Promise<ExpenseDocument | null> {
    const row = this.db
      .prepare(`SELECT * FROM expense_documents WHERE chat_id = ? AND file_unique_id = ?`)
      .get(chatId, fileUniqueId) as DocRow | undefined;
    return row ? rowToDoc(row) : null;
  }

  // ── chat_archive (архив всех сообщений/медиа группы) ────────────────────────

  /** Вставка записи архива. Дедуп делает вызывающий (по message_id / file_unique_id). */
  insertArchive(record: ChatArchiveRecord): ChatArchiveRecord {
    this.db
      .prepare(
        `INSERT INTO chat_archive
         (id, chat_id, thread_id, message_id, from_user_id, kind, doc_date, supplier, total,
          currency, raw_text, file_id, file_unique_id, file_name, mime_type, items_json,
          confidence, needs_review, created_at, ocr_status, expense_id, is_edited, revision, caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.chatId,
        record.threadId ?? null,
        record.messageId ?? null,
        record.fromUserId ?? null,
        record.kind,
        record.docDate ?? null,
        record.supplier ?? null,
        record.total ?? null,
        record.currency ?? null,
        record.rawText ?? null,
        record.fileId ?? null,
        record.fileUniqueId ?? null,
        record.fileName ?? null,
        record.mimeType ?? null,
        record.itemsJson ?? null,
        record.confidence ?? 0,
        record.needsReview ? 1 : 0,
        record.createdAt,
        record.ocrStatus ?? null,
        record.expenseId ?? null,
        record.isEdited ? 1 : 0,
        record.revision ?? 1,
        record.caption ?? null,
      );
    return record;
  }

  findArchiveByMessageId(chatId: string, messageId: string): ChatArchiveRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM chat_archive WHERE chat_id = ? AND message_id = ?`)
      .get(chatId, messageId) as ArchiveRow | undefined;
    return row ? archiveRowToRecord(row) : null;
  }

  /**
   * Правка (edited_message/edited_channel_post): обновить raw_text и поднять
   * ревизию, не создавая дубликатов (PROMPT 02, ArchiveRevision).
   */
  updateArchiveRevision(
    chatId: string,
    messageId: string,
    rawText: string,
  ): ChatArchiveRecord | null {
    const existing = this.findArchiveByMessageId(chatId, messageId);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE chat_archive SET raw_text = ?, is_edited = 1, revision = revision + 1
         WHERE chat_id = ? AND message_id = ?`,
      )
      .run(rawText, chatId, messageId);
    return this.findArchiveByMessageId(chatId, messageId);
  }

  /** G10: правка медиа (новая подпись/OCR) — ревизия, без дубликата. */
  updateArchiveMediaRevision(
    chatId: string,
    fileUniqueId: string,
    patch: { rawText?: string; caption?: string },
  ): ChatArchiveRecord | null {
    const existing = this.findArchiveByFileUniqueId(chatId, fileUniqueId);
    if (!existing) return null;
    const rawText = patch.rawText !== undefined ? patch.rawText : existing.rawText;
    const caption = patch.caption !== undefined ? patch.caption : existing.caption;
    this.db
      .prepare(
        `UPDATE chat_archive
         SET raw_text = ?, caption = ?, is_edited = 1, revision = revision + 1
         WHERE chat_id = ? AND file_unique_id = ?`,
      )
      .run(rawText ?? null, caption ?? null, chatId, fileUniqueId);
    return this.findArchiveByFileUniqueId(chatId, fileUniqueId);
  }

  // ── История групп (group_history / group_recent, H1–H5) ────────────────────

  /**
   * Сообщения архива чата с фильтрами. Порядок: новые первыми.
   * storageKey берётся из telegram_media (коррелированный подзапрос — без
   * дублей при повторной доставке одного file_unique_id).
   */
  listMessages(q: ArchiveListQuery): ChatArchiveRecord[] {
    const conds = ["ca.chat_id = ?"];
    const params: Array<string | number> = [q.chatId];
    if (q.threadId !== undefined) {
      conds.push("ca.thread_id = ?");
      params.push(q.threadId);
    }
    if (q.beforeMessageId !== undefined) {
      conds.push("ca.message_id IS NOT NULL");
      conds.push("CAST(ca.message_id AS INTEGER) < ?");
      params.push(Number(q.beforeMessageId) || 0);
    }
    if (q.kinds && q.kinds.length > 0) {
      conds.push(`ca.kind IN (${q.kinds.map(() => "?").join(", ")})`);
      params.push(...q.kinds);
    }
    if (q.fromDate) {
      conds.push("ca.created_at >= ?");
      params.push(q.fromDate);
    }
    if (q.toDate) {
      conds.push("ca.created_at <= ?");
      params.push(`${q.toDate}T23:59:59.999Z`);
    }
    const rows = this.db
      .prepare(
        `SELECT ca.*,
                (SELECT tm.storage_key FROM telegram_media tm
                  WHERE tm.chat_id = ca.chat_id AND tm.file_unique_id = ca.file_unique_id
                  ORDER BY tm.updated_at DESC LIMIT 1) AS storage_key
         FROM chat_archive ca
         WHERE ${conds.join(" AND ")}
         ORDER BY ca.created_at DESC, CAST(COALESCE(ca.message_id, '0') AS INTEGER) DESC
         LIMIT ?`,
      )
      .all(...params, q.limit) as ArchiveRow[];
    return rows.map(archiveRowToRecord);
  }

  /** Недавние события по списку чатов (group_recent): created_at >= sinceIso. */
  listRecent(q: { chatIds: string[]; sinceIso: string; limit: number }): ChatArchiveRecord[] {
    if (q.chatIds.length === 0) return [];
    const placeholders = q.chatIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT ca.*,
                (SELECT tm.storage_key FROM telegram_media tm
                  WHERE tm.chat_id = ca.chat_id AND tm.file_unique_id = ca.file_unique_id
                  ORDER BY tm.updated_at DESC LIMIT 1) AS storage_key
         FROM chat_archive ca
         WHERE ca.chat_id IN (${placeholders}) AND ca.created_at >= ?
         ORDER BY ca.created_at DESC
         LIMIT ?`,
      )
      .all(...q.chatIds, q.sinceIso, q.limit) as ArchiveRow[];
    return rows.map(archiveRowToRecord);
  }

  /** Топ чатов по последней активности (для group_recent без chatId, cap 10). */
  topRecentChats(chatIds: string[], limit: number): string[] {
    if (chatIds.length === 0) return [];
    const placeholders = chatIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT chat_id, MAX(created_at) AS last_at
         FROM chat_archive
         WHERE chat_id IN (${placeholders})
         GROUP BY chat_id
         ORDER BY last_at DESC
         LIMIT ?`,
      )
      .all(...chatIds, limit) as Array<{ chat_id: string }>;
    return rows.map((r) => r.chat_id);
  }

  // ── telegram_media (PROMPT 05: постоянное хранение + статусы обработки) ────

  insertMedia(
    rec: Omit<TelegramMediaRecord, "id" | "createdAt" | "updatedAt"> &
      Partial<Pick<TelegramMediaRecord, "processingStatus" | "lastError">>,
  ): TelegramMediaRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO telegram_media
         (chat_id, message_id, thread_id, file_unique_id, telegram_file_id, storage_key,
          mime_type, file_name, size_bytes, sha256, caption, processing_status, last_error,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.chatId,
        rec.messageId,
        rec.threadId ?? null,
        rec.fileUniqueId,
        rec.telegramFileId,
        rec.storageKey,
        rec.mimeType ?? null,
        rec.fileName ?? null,
        rec.sizeBytes ?? null,
        rec.sha256 ?? null,
        rec.caption ?? null,
        rec.processingStatus ?? "received",
        rec.lastError ?? null,
        now,
        now,
      );
    return this.findMediaByFileUniqueId(rec.chatId, rec.fileUniqueId)!;
  }

  findMediaByFileUniqueId(chatId: string, fileUniqueId: string): TelegramMediaRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM telegram_media WHERE chat_id = ? AND file_unique_id = ?`)
      .get(chatId, fileUniqueId) as MediaRow | undefined;
    return row ? mediaRowToRecord(row) : null;
  }

  /** G2: отправить сохранённый файл по storage_key (только своего чата). */
  findMediaByStorageKey(chatId: string, storageKey: string): TelegramMediaRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM telegram_media WHERE chat_id = ? AND storage_key = ?`)
      .get(chatId, storageKey) as MediaRow | undefined;
    return row ? mediaRowToRecord(row) : null;
  }

  updateMediaStatus(id: number, status: MediaProcessingStatus, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE telegram_media SET processing_status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, lastError ?? null, new Date().toISOString(), id);
  }

  /** PROMPT 07: 'processing'-записи старше порога — после crash вернуть в работу. */
  findStaleProcessing(staleBeforeMs: number, limit = 10): TelegramMediaRecord[] {
    const cutoff = new Date(Date.now() - staleBeforeMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM telegram_media
         WHERE processing_status IN ('processing', 'downloading')
           AND updated_at <= ?
         ORDER BY updated_at ASC LIMIT ?`,
      )
      .all(cutoff, limit) as MediaRow[];
    return rows.map(mediaRowToRecord);
  }

  findArchiveByFileUniqueId(chatId: string, fileUniqueId: string): ChatArchiveRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM chat_archive WHERE chat_id = ? AND file_unique_id = ?`)
      .get(chatId, fileUniqueId) as ArchiveRow | undefined;
    return row ? archiveRowToRecord(row) : null;
  }

  countArchive(chatId?: string): number {
    if (!chatId) {
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM chat_archive`).get() as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM chat_archive WHERE chat_id = ?`)
      .get(chatId) as { n: number };
    return row.n;
  }

  async getById(id: string): Promise<ExpenseDocument | null> {
    const row = this.db.prepare(`SELECT * FROM expense_documents WHERE id = ?`).get(id) as
      | DocRow
      | undefined;
    return row ? rowToDoc(row) : null;
  }

  /** Последний расход чата (для expense_update без явного expenseId). */
  async findLatestByChat(chatId: string): Promise<ExpenseDocument | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM expense_documents WHERE chat_id = ?
         ORDER BY created_at DESC, CAST(COALESCE(message_id, '0') AS INTEGER) DESC LIMIT 1`,
      )
      .get(chatId) as DocRow | undefined;
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
    const threadId = q.threadId ?? null;
    const supplierNeedle = q.supplier?.trim() ? q.supplier.trim().toLowerCase() : null;
    // R4: «весь период» не должен молча резаться — потолок 10 000 записей.
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 10_000);

    // supplier-фильтр — в JS: sqlite lower() не умеет кириллицу.
    const rows = this.db
      .prepare(
        `SELECT * FROM expense_documents
         WHERE chat_id = ?
           AND (? IS NULL OR thread_id = ?)
           AND (? IS NULL OR doc_date >= ?)
           AND (? IS NULL OR doc_date <= ?)
         ORDER BY doc_date DESC, created_at DESC
         LIMIT ?`,
      )
      .all(chatId, threadId, threadId, fromDate, fromDate, toDate, toDate, limit) as DocRow[];

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
        category: d.category,
      })),
      note,
    };
  }

  // ── F3/F4: исправление категории + chat-scoped обучение ─────────────────────

  /** Обновить категорию/теги расхода (пользовательская правка). */
  async updateExpenseCategory(
    id: string,
    patch: { category?: string | null; addTags?: string[] },
  ): Promise<ExpenseDocument | null> {
    const existing = this.db
      .prepare(`SELECT * FROM expense_documents WHERE id = ?`)
      .get(id) as DocRow | undefined;
    if (!existing) return null;
    const nextCategory =
      patch.category !== undefined ? patch.category : existing.category;
    let nextTags: string[] = existing.tags ? (JSON.parse(existing.tags) as string[]) : [];
    for (const t of patch.addTags ?? []) {
      if (t && !nextTags.includes(t)) nextTags.push(t);
    }
    this.db
      .prepare(
        `UPDATE expense_documents SET category = ?, tags = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        nextCategory ?? null,
        nextTags.length ? JSON.stringify(nextTags) : null,
        new Date().toISOString(),
        id,
      );
    return await this.getById(id);
  }

  /** F4: запомнить исправление категории в рамках чата (supplier → category). */
  upsertExpenseLearning(input: {
    chatId: string;
    patternType: "supplier" | "keyword";
    pattern: string;
    category: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO expense_learning (chat_id, pattern_type, pattern, category, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, pattern_type, pattern)
         DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`,
      )
      .run(
        input.chatId,
        input.patternType,
        input.pattern,
        input.category,
        new Date().toISOString(),
      );
  }

  /** F2.1: подсказки памяти чата для classify. */
  listExpenseLearning(chatId: string): Array<{
    patternType: string;
    pattern: string;
    category: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT pattern_type, pattern, category FROM expense_learning
         WHERE chat_id = ? ORDER BY updated_at DESC LIMIT 50`,
      )
      .all(chatId) as Array<{ pattern_type: string; pattern: string; category: string }>;
    return rows.map((r) => ({
      patternType: r.pattern_type,
      pattern: r.pattern,
      category: r.category,
    }));
  }

  // ── F6: гибкий поиск по расходам («сколько метров кабеля») ─────────────────

  /** LIKE-поиск по raw_text/supplier/category/line_items; возвращает строки+фрагменты. */
  searchExpenses(q: {
    chatId: string;
    query: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }): Array<{
    id: string;
    docDate: string;
    supplier?: string;
    total?: number;
    currency: string;
    category?: string | null;
    rawText?: string;
    lineItems?: ExpenseDocument["lineItems"];
  }> {
    const needle = q.query.trim().toLowerCase();
    if (!needle) return [];
    const like = `%${needle}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM expense_documents
         WHERE chat_id = ?
           AND (? IS NULL OR doc_date >= ?)
           AND (? IS NULL OR doc_date <= ?)
           AND (
             LOWER(COALESCE(raw_text, '')) LIKE ?
             OR LOWER(COALESCE(supplier, '')) LIKE ?
             OR LOWER(COALESCE(category, '')) LIKE ?
             OR LOWER(COALESCE(line_items, '')) LIKE ?
           )
         ORDER BY doc_date DESC
         LIMIT ?`,
      )
      .all(
        q.chatId,
        q.fromDate ?? null,
        q.fromDate ?? null,
        q.toDate ?? null,
        q.toDate ?? null,
        like,
        like,
        like,
        like,
        q.limit ?? 20,
      ) as DocRow[];
    return rows.map((r) => {
      const doc = rowToDoc(r);
      return {
        id: doc.id,
        docDate: doc.docDate,
        supplier: doc.supplier,
        total: doc.total,
        currency: doc.currency,
        category: doc.category,
        rawText: doc.rawText,
        lineItems: doc.lineItems,
      };
    });
  }
}
