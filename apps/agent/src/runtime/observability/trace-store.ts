/**
 * Prompt 02 — минимальная persistence AgentTrace (SQLite).
 *
 * Отдельная БД `~/.grish-ai/traces.sqlite` (не смешиваем с memory.sqlite).
 * Одна таблица `agent_traces`; steps/final — JSON-колонки (обоснование: шаги
 * append-only и ограничены, анализ идёт на уровне trace — join не нужен).
 *
 * Retention: удаление trace старше `retentionDays` (default 30) при каждом save.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { getConfigDir } from "@griha/config";
import type { AgentTrace, AgentTraceFinal } from "./trace.js";
import type { FailureChainEntry, PrimaryFailure } from "./error-taxonomy.js";

export interface TraceStoreOptions {
  filePath?: string;
  retentionDays?: number;
  now?: () => string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_traces (
  trace_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  user_id TEXT,
  chat_id TEXT,
  thread_id TEXT,
  task_type TEXT,
  steps_json TEXT NOT NULL,
  final_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  primary_failure_json TEXT,
  failure_chain_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_traces_session ON agent_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_started ON agent_traces(started_at);
`;

const LATE_COLUMNS = [
  "retry_count INTEGER NOT NULL DEFAULT 0",
  "primary_failure_json TEXT",
  "failure_chain_json TEXT",
];

export function defaultTraceDbPath(): string {
  return path.join(getConfigDir(), "traces.sqlite");
}

export class TraceStore {
  private readonly db: Database.Database;
  private readonly retentionDays: number;
  private readonly now: () => string;

  constructor(options: TraceStoreOptions = {}) {
    this.db = new Database(options.filePath ?? defaultTraceDbPath());
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
    this.retentionDays = options.retentionDays ?? 30;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Добавляет колонки, появившиеся после Prompt 02, в уже созданную таблицу. */
  private migrate(): void {
    const columns = this.db.prepare("PRAGMA table_info(agent_traces)").all() as Array<{ name: string }>;
    const existing = new Set(columns.map((c) => c.name));
    for (const col of LATE_COLUMNS) {
      const name = col.split(" ")[0];
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE agent_traces ADD COLUMN ${col}`);
      }
    }
  }

  /** Upsert trace (INSERT OR REPLACE) + retention-prune. */
  save(trace: AgentTrace): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_traces (
        trace_id, session_id, agent_version, status,
        started_at, finished_at, user_id, chat_id, thread_id, task_type,
        steps_json, final_json, retry_count, primary_failure_json, failure_chain_json, created_at
      ) VALUES (
        @traceId, @sessionId, @agentVersion, @status,
        @startedAt, @finishedAt, @userId, @chatId, @threadId, @taskType,
        @stepsJson, @finalJson, @retryCount, @primaryFailureJson, @failureChainJson, @createdAt
      )
    `);
    stmt.run({
      traceId: trace.traceId,
      sessionId: trace.sessionId,
      agentVersion: trace.agentVersion,
      status: trace.status,
      startedAt: trace.startedAt,
      finishedAt: trace.finishedAt ?? null,
      userId: trace.userId ?? null,
      chatId: trace.chatId ?? null,
      threadId: trace.threadId ?? null,
      taskType: trace.taskType ?? null,
      stepsJson: JSON.stringify(trace.steps),
      finalJson: trace.final ? JSON.stringify(trace.final) : null,
      retryCount: trace.retryCount ?? 0,
      primaryFailureJson: trace.primaryFailure ? JSON.stringify(trace.primaryFailure) : null,
      failureChainJson: trace.failureChain ? JSON.stringify(trace.failureChain) : null,
      createdAt: this.now(),
    });
    this.prune();
  }

  /** Retention: удалить trace старше retentionDays по started_at. */
  private prune(): void {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000).toISOString();
    this.db.prepare("DELETE FROM agent_traces WHERE started_at < ?").run(cutoff);
  }

  /** Прочитать trace по id (для тестов/диагностики). */
  get(traceId: string): AgentTrace | null {
    const row = this.db
      .prepare("SELECT * FROM agent_traces WHERE trace_id = ?")
      .get(traceId) as TraceRow | undefined;
    return row ? rowToTrace(row) : null;
  }

  /** Все trace (по убыванию started_at), опционально за период/лимит. */
  list(options: { since?: string; limit?: number } = {}): AgentTrace[] {
    const where = options.since ? "WHERE started_at >= ?" : "";
    const params = options.since ? [options.since] : [];
    const limit = options.limit !== undefined ? "LIMIT ?" : "";
    const limitParams = options.limit !== undefined ? [options.limit] : [];
    const rows = this.db
      .prepare(`SELECT * FROM agent_traces ${where} ORDER BY started_at DESC ${limit}`)
      .all(...params, ...limitParams) as TraceRow[];
    return rows.map(rowToTrace);
  }

  close(): void {
    this.db.close();
  }
}

interface TraceRow {
  trace_id: string;
  session_id: string;
  agent_version: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  user_id: string | null;
  chat_id: string | null;
  thread_id: string | null;
  task_type: string | null;
  steps_json: string;
  final_json: string | null;
  retry_count: number;
  primary_failure_json: string | null;
  failure_chain_json: string | null;
}

function rowToTrace(row: TraceRow): AgentTrace {
  return {
    traceId: row.trace_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    userId: row.user_id ?? undefined,
    chatId: row.chat_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    taskType: row.task_type ?? undefined,
    agentVersion: row.agent_version,
    status: row.status as AgentTrace["status"],
    steps: JSON.parse(row.steps_json) as AgentTrace["steps"],
    retryCount: row.retry_count ?? 0,
    primaryFailure: row.primary_failure_json
      ? (JSON.parse(row.primary_failure_json) as PrimaryFailure)
      : undefined,
    failureChain: row.failure_chain_json
      ? (JSON.parse(row.failure_chain_json) as FailureChainEntry[])
      : undefined,
    final: row.final_json ? (JSON.parse(row.final_json) as AgentTraceFinal) : undefined,
  };
}

let singleton: TraceStore | null = null;

/** Process-wide TraceStore (default — durable SQLite). */
export function getTraceStore(): TraceStore {
  if (!singleton) singleton = new TraceStore();
  return singleton;
}
