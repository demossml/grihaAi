/**
 * MediaRetryQueue — очередь отложенных скачиваний/OCR медиа (R-GR-7).
 * Сбой download не роняет file_id навсегда: job попадает в SQLite-очередь,
 * worker ретраит с backoff, после max_attempts — dead-letter.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfigDir } from "@griha/config";

export type MediaRetryKind = "photo" | "document" | "voice";
export type MediaRetryStatus = "pending" | "processing" | "done" | "dead";

export interface MediaRetryJob {
  id: string;
  chatId: string;
  threadId?: string;
  messageId?: string;
  fileId: string;
  fileUniqueId?: string;
  kind: MediaRetryKind;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  status: MediaRetryStatus;
  createdAt: string;
  updatedAt: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS media_retry_jobs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  kind TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_retry_next
  ON media_retry_jobs(status, next_attempt_at);
`;

interface JobRow {
  id: string;
  chat_id: string;
  thread_id: string | null;
  message_id: string | null;
  file_id: string;
  file_unique_id: string | null;
  kind: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): MediaRetryJob {
  return {
    id: row.id,
    chatId: row.chat_id,
    threadId: row.thread_id ?? undefined,
    messageId: row.message_id ?? undefined,
    fileId: row.file_id,
    fileUniqueId: row.file_unique_id ?? undefined,
    kind: row.kind as MediaRetryKind,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    status: row.status as MediaRetryStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Backoff: min(3600, 30 * 2^attempts) секунд. */
export function mediaRetryBackoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * Math.pow(2, Math.max(1, attempts)));
}

export function getMediaRetryDbPath(): string {
  return path.join(getConfigDir(), "media-retry.sqlite");
}

export class MediaRetryQueue {
  private db: Database.Database;

  constructor(dbPath: string = getMediaRetryDbPath()) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Поставить job в очередь. Дедуп: если тот же chat + file_unique_id уже
   * pending/processing — не дублируем (R-GR-7: без залипания очереди).
   */
  async enqueue(job: {
    chatId: string | number;
    threadId?: string | number;
    messageId?: string | number;
    fileId: string;
    fileUniqueId?: string;
    kind: MediaRetryKind;
  }): Promise<void> {
    const chatId = String(job.chatId);
    const key = job.fileUniqueId ?? job.fileId;
    const existing = this.db
      .prepare(
        `SELECT id FROM media_retry_jobs
         WHERE chat_id = ? AND status IN ('pending','processing')
           AND (file_unique_id = ? OR file_id = ?)`,
      )
      .get(chatId, key, key) as { id: string } | undefined;
    if (existing) return;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO media_retry_jobs
         (id, chat_id, thread_id, message_id, file_id, file_unique_id, kind,
          attempts, max_attempts, next_attempt_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 10, ?, 'pending', ?, ?)`,
      )
      .run(
        randomUUID(),
        chatId,
        job.threadId !== undefined ? String(job.threadId) : null,
        job.messageId !== undefined ? String(job.messageId) : null,
        job.fileId,
        job.fileUniqueId ?? null,
        job.kind,
        now,
        now,
        now,
      );
  }

  /** Забрать до `limit` просроченных pending-job'ов (помечаются processing). */
  async claimDue(limit: number): Promise<MediaRetryJob[]> {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM media_retry_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC LIMIT ?`,
      )
      .all(now, limit) as JobRow[];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `UPDATE media_retry_jobs SET status = 'processing', updated_at = ? WHERE id IN (${placeholders})`,
      )
      .run(now, ...ids);
    return rows.map((r) => ({ ...rowToJob(r), status: "processing" as const }));
  }

  async markDone(id: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE media_retry_jobs SET status = 'done', updated_at = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
  }

  /** attempts++ и backoff; attempts >= max_attempts → dead. */
  async markFailure(id: string, error: string): Promise<void> {
    const row = this.db
      .prepare(`SELECT * FROM media_retry_jobs WHERE id = ?`)
      .get(id) as JobRow | undefined;
    if (!row) return;
    const attempts = row.attempts + 1;
    const status: MediaRetryStatus = attempts >= row.max_attempts ? "dead" : "pending";
    const nextAttemptAt =
      status === "dead"
        ? row.next_attempt_at
        : new Date(Date.now() + mediaRetryBackoffSeconds(attempts) * 1000).toISOString();
    this.db
      .prepare(
        `UPDATE media_retry_jobs
         SET attempts = ?, status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(attempts, status, nextAttemptAt, error, new Date().toISOString(), id);
  }
}

export interface MediaWorkerOptions {
  queue: MediaRetryQueue;
  /** Обработать один job: download → OCR/ingest. Throw → markFailure. */
  processJob: (job: MediaRetryJob) => Promise<void>;
  intervalMs?: number;
  claimLimit?: number;
}

/** Запустить фоновый воркер; возвращает функцию остановки. */
export function startMediaRetryWorker(opts: MediaWorkerOptions): () => void {
  const intervalMs = opts.intervalMs ?? 60_000;
  const claimLimit = opts.claimLimit ?? 3;

  const tick = async (): Promise<void> => {
    try {
      const jobs = await opts.queue.claimDue(claimLimit);
      for (const job of jobs) {
        try {
          await opts.processJob(job);
          await opts.queue.markDone(job.id);
        } catch (err: unknown) {
          await opts.queue.markFailure(
            job.id,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        "[media-retry] worker tick failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  console.log(`[media-retry] worker started (every ${intervalMs}ms, claim ${claimLimit})`);
  return () => {
    clearInterval(timer);
    console.log("[media-retry] worker stopped");
  };
}
