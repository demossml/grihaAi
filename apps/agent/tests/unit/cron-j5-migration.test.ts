/**
 * Item 10.1 (J5): перенос P02-схемы — nullable chat_id/thread_id/delivery_status,
 * idempotent-миграция на clean DB и на существующей БД старой схемы.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { CronService } from "../../.pi/extensions/cron/CronService.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "cron-j5.sqlite";

const OLD_SCHEMA_SQL = `
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

function columns(dbPath: string, table: string): string[] {
  const db = new Database(dbPath);
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
  } finally {
    db.close();
  }
}

describe("Cron J5 migration (Item 10.1)", () => {
  it("clean DB: колонки J5 создаются при init", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const jobs = columns(getTestDbPath(DB), "cron_jobs");
      assert.ok(jobs.includes("chat_id"));
      assert.ok(jobs.includes("thread_id"));
      const runs = columns(getTestDbPath(DB), "cron_runs");
      assert.ok(runs.includes("delivery_status"));
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("existing-DB старой схемы: миграция добавляет колонки и сохраняет данные", async () => {
    cleanTestDb(DB);
    const path = getTestDbPath(DB);
    const legacy = new Database(path);
    legacy.exec(OLD_SCHEMA_SQL);
    legacy
      .prepare(
        `INSERT INTO cron_jobs (id, name, schedule, prompt, created_at, updated_at)
         VALUES ('j1', 'legacy', 'daily', 'p', '2026-01-01', '2026-01-01')`,
      )
      .run();
    legacy.close();

    const svc = new CronService(path);
    await svc.init();
    try {
      assert.ok(columns(path, "cron_jobs").includes("chat_id"));
      assert.ok(columns(path, "cron_runs").includes("delivery_status"));
      const job = await svc.getJob("j1");
      assert.equal(job?.id, "j1");
      assert.equal(job?.chatId, undefined);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("повторный init на уже мигрированной БД — idempotent (без ошибок)", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    await svc.close();
    const again = new CronService(getTestDbPath(DB));
    await again.init();
    try {
      assert.ok(columns(getTestDbPath(DB), "cron_jobs").includes("thread_id"));
    } finally {
      await again.close();
      cleanTestDb(DB);
    }
  });

  it("createJob возвращает chatId/threadId undefined (wiring позже)", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({ name: "n", schedule: "daily", prompt: "p" });
      assert.equal(job.chatId, undefined);
      assert.equal(job.threadId, undefined);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});
