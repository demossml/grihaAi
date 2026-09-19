/**
 * GroupReminderService — chat-scoped напоминания (S12).
 *
 * Additive таблица `group_reminders` в отдельном файле SQLite
 * (~/.grish-ai/group-reminders.sqlite) — НЕ трогает commitments.sqlite /
 * memory.sqlite / documents.sqlite. Никаких DELETE по chat_id.
 *
 * Отличие от CommitmentService: обязательства — per-user (user_id); здесь —
 * per-chat (chat_id + thread_id), с привязкой к source_message_id.
 *
 * Low confidence → status needs_confirmation (без авто-спама).
 * Archived-чат → fireDue пропускает (не шлёт напоминание).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfigDir } from "@griha/config";

export type GroupReminderStatus = "pending" | "needs_confirmation" | "fired" | "cancelled";

export interface GroupReminder {
  id: string;
  chatId: string;
  threadId?: string;
  sourceMessageId?: string;
  dueAt: string;
  text: string;
  status: GroupReminderStatus;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupReminderAddInput {
  chatId: string;
  threadId?: string;
  sourceMessageId?: string;
  dueAt: string;
  text: string;
  /** 0..1; < LOW_CONFIDENCE_THRESHOLD → needs_confirmation. */
  confidence?: number;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS group_reminders (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
  source_message_id TEXT,
  due_at TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_reminders_due
  ON group_reminders(status, due_at);
`;

interface ReminderRow {
  id: string;
  chat_id: string;
  thread_id: string | null;
  source_message_id: string | null;
  due_at: string;
  text: string;
  status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

function rowToReminder(row: ReminderRow): GroupReminder {
  return {
    id: row.id,
    chatId: row.chat_id,
    threadId: row.thread_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    dueAt: row.due_at,
    text: row.text,
    status: row.status as GroupReminderStatus,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Депсы fireDue: проверка активности чата + доставка (инъекция для тестов). */
export interface FireReminderDeps {
  /** true → чат active (слушает); archived/pending → false → пропустить. */
  isChatActive: (chatId: string) => boolean;
  /** Доставка напоминания (telegram send с threadId). */
  send: (chatId: string, text: string, threadId?: string) => Promise<void>;
}

export function getGroupRemindersDbPath(): string {
  return path.join(getConfigDir(), "group-reminders.sqlite");
}

export class GroupReminderService {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

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

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("GroupReminderService not initialized — call init() first");
    return this.db;
  }

  add(input: GroupReminderAddInput): GroupReminder {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const confidence = input.confidence ?? 1;
    const status: GroupReminderStatus =
      confidence < LOW_CONFIDENCE_THRESHOLD ? "needs_confirmation" : "pending";
    const id = randomUUID();
    db.prepare(
      `INSERT INTO group_reminders
       (id, chat_id, thread_id, source_message_id, due_at, text, status, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.chatId,
      input.threadId ?? null,
      input.sourceMessageId ?? null,
      input.dueAt,
      input.text,
      status,
      confidence,
      now,
      now,
    );
    return this.get(id)!;
  }

  get(id: string): GroupReminder | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM group_reminders WHERE id = ?`).get(id) as
      | ReminderRow
      | undefined;
    return row ? rowToReminder(row) : undefined;
  }

  /** Просроченные pending-напоминания (не fired/cancelled/needs_confirmation). */
  listDue(now: Date = new Date()): GroupReminder[] {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM group_reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC`)
      .all(now.toISOString()) as ReminderRow[];
    return rows.map(rowToReminder);
  }

  /**
   * Разослать просроченные напоминания. Archived/pending-чат → пропуск (не шлём).
   * Low-confidence (needs_confirmation) сюда не попадают (listDue фильтрует).
   * Никаких DELETE — fired помечается статусом.
   */
  async fireDue(now: Date, deps: FireReminderDeps): Promise<{ fired: number; skipped: number }> {
    const due = this.listDue(now);
    let fired = 0;
    let skipped = 0;
    for (const r of due) {
      if (!deps.isChatActive(r.chatId)) {
        skipped++;
        continue; // archived/pending — не шлём напоминание.
      }
      await deps.send(r.chatId, r.text, r.threadId);
      this.markFired(r.id);
      fired++;
    }
    return { fired, skipped };
  }

  markFired(id: string): void {
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(`UPDATE group_reminders SET status = 'fired', updated_at = ? WHERE id = ?`)
      .run(now, id);
  }

  markCancelled(id: string): void {
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(`UPDATE group_reminders SET status = 'cancelled', updated_at = ? WHERE id = ?`)
      .run(now, id);
  }

  /** P0-4: напоминания чата (опционально по статусу). */
  list(chatId: string, status?: GroupReminderStatus): GroupReminder[] {
    const rows = status
      ? (this.requireDb()
          .prepare(`SELECT * FROM group_reminders WHERE chat_id = ? AND status = ? ORDER BY due_at ASC`)
          .all(chatId, status) as ReminderRow[])
      : (this.requireDb()
          .prepare(`SELECT * FROM group_reminders WHERE chat_id = ? ORDER BY due_at ASC`)
          .all(chatId) as ReminderRow[]);
    return rows.map(rowToReminder);
  }

  /** P0-4: подтвердить needs_confirmation → pending. Возвращает обновлённый, иначе undefined. */
  confirm(id: string): GroupReminder | undefined {
    const existing = this.get(id);
    if (!existing || existing.status !== "needs_confirmation") return undefined;
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(`UPDATE group_reminders SET status = 'pending', updated_at = ? WHERE id = ?`)
      .run(now, id);
    return this.get(id);
  }
}

let singleton: GroupReminderService | null = null;

/** Единый инстанс на процесс (~/.grish-ai/group-reminders.sqlite). */
export function getGroupReminderService(): GroupReminderService {
  if (!singleton) {
    singleton = new GroupReminderService(getGroupRemindersDbPath());
    singleton.init();
  }
  return singleton;
}
