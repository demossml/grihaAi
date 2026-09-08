import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { CronJob, CronRunRecord } from "../../../src/types/index.js";

export interface CronJobInput {
  name: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  continuity?: boolean;
  monitorMode?: boolean;
  projectId?: string;
}

/** Executes a cron job. Swap for a real LLM runner later. */
export interface CronRunner {
  (job: CronJob, effectivePrompt: string): Promise<{ result: string; usedLlm: boolean }>;
}

/** Lightweight change detector for monitor mode (returns true = changed). */
export interface CronChangeDetector {
  (job: CronJob): Promise<boolean>;
}

interface CronJobRow {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: number;
  continuity: number;
  monitor_mode: number;
  last_run_at: string | null;
  last_result: string | null;
  notepad: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CronRunRow {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  result: string | null;
  used_llm: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  continuity INTEGER NOT NULL DEFAULT 0,
  monitor_mode INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_result TEXT,
  notepad TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  result TEXT,
  used_llm INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id);
`;

/** Minimal due-check: schedule "N minutes" / "every N minutes" / bare number. */
function intervalMinutes(schedule: string): number {
  const match = schedule.match(/(\d+)/);
  return match ? Math.max(1, Number(match[1])) : 60;
}

function isDue(job: CronJob, now: Date): boolean {
  if (!job.enabled) return false;
  if (!job.lastRunAt) return true;
  const minutes = intervalMinutes(job.schedule);
  return now.getTime() - new Date(job.lastRunAt).getTime() >= minutes * 60_000;
}

export class CronService {
  private db: Database.Database | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly runner?: CronRunner,
    private readonly changeDetector?: CronChangeDetector,
  ) {}

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("CronService not initialized — call init() first");
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

  async createJob(input: CronJobInput): Promise<CronJob> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    const row: CronJobRow = {
      id,
      name: input.name,
      schedule: input.schedule,
      prompt: input.prompt,
      enabled: input.enabled === false ? 0 : 1,
      continuity: input.continuity ? 1 : 0,
      monitor_mode: input.monitorMode ? 1 : 0,
      last_run_at: null,
      last_result: null,
      notepad: null,
      project_id: input.projectId ?? null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO cron_jobs (id, name, schedule, prompt, enabled, continuity, monitor_mode, last_run_at, last_result, notepad, project_id, created_at, updated_at)
       VALUES (@id, @name, @schedule, @prompt, @enabled, @continuity, @monitor_mode, @last_run_at, @last_result, @notepad, @project_id, @created_at, @updated_at)`,
    ).run(row);
    return this.rowToJob(row);
  }

  async listJobs(): Promise<CronJob[]> {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM cron_jobs ORDER BY created_at ASC`).all() as CronJobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  async getJob(id: string): Promise<CronJob | null> {
    const db = this.requireDb();
    const row = db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronJobRow | undefined;
    return row ? this.rowToJob(row) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<CronJob | null> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    db.prepare(`UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, now, id);
    return this.getJob(id);
  }

  async updateNotepad(id: string, text: string): Promise<CronJob | null> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    db.prepare(`UPDATE cron_jobs SET notepad = ?, updated_at = ? WHERE id = ?`).run(text, now, id);
    return this.getJob(id);
  }

  async runJobNow(jobId: string): Promise<CronRunRecord> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Unknown cron job: ${jobId}`);
    return this.run(job);
  }

  async tick(): Promise<CronRunRecord[]> {
    const now = new Date();
    const due = (await this.listJobs()).filter((j) => isDue(j, now));
    const records: CronRunRecord[] = [];
    for (const job of due) {
      records.push(await this.run(job));
    }
    return records;
  }

  async listRuns(jobId?: string): Promise<CronRunRecord[]> {
    const db = this.requireDb();
    let rows: CronRunRow[];
    if (jobId) {
      rows = db
        .prepare(`SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at ASC`)
        .all(jobId) as CronRunRow[];
    } else {
      rows = db.prepare(`SELECT * FROM cron_runs ORDER BY started_at ASC`).all() as CronRunRow[];
    }
    return rows.map((r) => this.rowToRun(r));
  }

  private async run(job: CronJob): Promise<CronRunRecord> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    if (job.monitorMode && this.changeDetector) {
      const changed = await this.changeDetector(job);
      if (!changed) {
        return this.insertRun({
          id: runId,
          jobId: job.id,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "skipped",
          usedLlm: false,
        });
      }
    }

    let effectivePrompt = job.prompt;
    if (job.continuity) {
      const parts = [job.prompt];
      if (job.lastResult) parts.push(`Previous result:\n${job.lastResult}`);
      if (job.notepad) parts.push(`Notepad:\n${job.notepad}`);
      effectivePrompt = parts.join("\n\n");
    }

    try {
      let result: string;
      let usedLlm: boolean;
      if (this.runner) {
        const r = await this.runner(job, effectivePrompt);
        result = r.result;
        usedLlm = r.usedLlm;
      } else {
        result = `Job "${job.name}" executed (no runner configured).`;
        usedLlm = false;
      }

      const finishedAt = new Date().toISOString();
      this.requireDb()
        .prepare(`UPDATE cron_jobs SET last_run_at = ?, last_result = ?, updated_at = ? WHERE id = ?`)
        .run(finishedAt, result, finishedAt, job.id);

      return this.insertRun({
        id: runId,
        jobId: job.id,
        startedAt,
        finishedAt,
        status: "success",
        result,
        usedLlm,
      });
    } catch (error) {
      return this.insertRun({
        id: runId,
        jobId: job.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "failed",
        result: error instanceof Error ? error.message : String(error),
        usedLlm: false,
      });
    }
  }

  private insertRun(run: CronRunRecord): CronRunRecord {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO cron_runs (id, job_id, started_at, finished_at, status, result, used_llm)
       VALUES (@id, @job_id, @started_at, @finished_at, @status, @result, @used_llm)`,
    ).run({
      id: run.id,
      job_id: run.jobId,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      status: run.status,
      result: run.result ?? null,
      used_llm: run.usedLlm ? 1 : 0,
    });
    return run;
  }

  private rowToJob(row: CronJobRow): CronJob {
    return {
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      prompt: row.prompt,
      enabled: row.enabled !== 0,
      continuity: row.continuity !== 0,
      monitorMode: row.monitor_mode !== 0,
      lastRunAt: row.last_run_at ?? undefined,
      lastResult: row.last_result ?? undefined,
      notepad: row.notepad ?? undefined,
      projectId: row.project_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToRun(row: CronRunRow): CronRunRecord {
    return {
      id: row.id,
      jobId: row.job_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      status: row.status as CronRunRecord["status"],
      result: row.result ?? undefined,
      usedLlm: row.used_llm !== 0,
    };
  }
}
