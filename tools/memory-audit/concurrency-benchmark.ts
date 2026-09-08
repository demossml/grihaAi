/**
 * Concurrency benchmark on a TEMPORARY DB: multiple better-sqlite3 connections
 * in one Node process (synchronous driver, so this measures connection-level
 * contention + busy_timeout behaviour, not multi-core parallelism — noted in
 * the report). Counts SQLITE_BUSY / SQLITE_LOCKED, measures latency.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { hrtMs, latencyStats } from "./lib.js";

export interface ConcurrencyResult {
  writers: number;
  readers: number;
  busyErrors: number;
  lockedErrors: number;
  otherErrors: number;
  writeLatencyMs: ReturnType<typeof latencyStats>;
  readLatencyMs: ReturnType<typeof latencyStats>;
  consistency: boolean;
  note: string;
}

function open(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 2000");
  return db;
}

async function runScenario(
  dbPath: string,
  writers: number,
  readers: number,
  opsPerWorker = 200,
): Promise<ConcurrencyResult> {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });

  const setup = open(dbPath);
  setup.exec(`CREATE TABLE bench_facts (id TEXT PRIMARY KEY, content TEXT NOT NULL)`);
  setup.exec(`CREATE VIRTUAL TABLE bench_fts USING fts5(content, content='bench_facts', content_rowid='rowid')`);
  setup.exec(`CREATE TRIGGER bench_ai AFTER INSERT ON bench_facts BEGIN
    INSERT INTO bench_fts(rowid, content) VALUES (new.rowid, new.content);
  END`);
  setup.close();

  let busy = 0;
  let locked = 0;
  let other = 0;
  const writeSamples: number[] = [];
  const readSamples: number[] = [];

  const conns: Database.Database[] = [];
  for (let i = 0; i < writers + readers; i++) conns.push(open(dbPath));

  const writeStmt = (db: Database.Database) =>
    db.prepare(`INSERT INTO bench_facts (id, content) VALUES (?, ?)`);
  const readStmt = (db: Database.Database) =>
    db.prepare(`SELECT count(*) c FROM bench_fts WHERE bench_fts MATCH ?`);

  const tasks: Promise<void>[] = [];
  for (let w = 0; w < writers; w++) {
    const conn = conns[w];
    const ins = writeStmt(conn);
    tasks.push(
      (async () => {
        for (let i = 0; i < opsPerWorker; i++) {
          const t0 = hrtMs();
          try {
            ins.run(`w${w}-${i}`, `concurrent fact ${w} ${i}`);
            writeSamples.push(hrtMs() - t0);
          } catch (err) {
            const code = (err as { code?: string }).code ?? "";
            if (code === "SQLITE_BUSY") busy++;
            else if (code === "SQLITE_LOCKED") locked++;
            else other++;
          }
          if (i % 10 === 0) await new Promise((r) => setImmediate(r));
        }
      })(),
    );
  }
  for (let r = 0; r < readers; r++) {
    const conn = conns[writers + r];
    const sel = readStmt(conn);
    tasks.push(
      (async () => {
        for (let i = 0; i < opsPerWorker; i++) {
          const t0 = hrtMs();
          try {
            sel.get(`"concurrent"*`);
            readSamples.push(hrtMs() - t0);
          } catch (err) {
            const code = (err as { code?: string }).code ?? "";
            if (code === "SQLITE_BUSY") busy++;
            else if (code === "SQLITE_LOCKED") locked++;
            else other++;
          }
          if (i % 10 === 0) await new Promise((r) => setImmediate(r));
        }
      })(),
    );
  }

  await Promise.all(tasks);
  for (const c of conns) c.close();

  const check = open(dbPath);
  const count = (check.prepare(`SELECT count(*) c FROM bench_facts`).get() as { c: number }).c;
  const ftsCount = (check.prepare(`SELECT count(*) c FROM bench_fts`).get() as { c: number }).c;
  check.close();

  return {
    writers,
    readers,
    busyErrors: busy,
    lockedErrors: locked,
    otherErrors: other,
    writeLatencyMs: latencyStats(writeSamples),
    readLatencyMs: latencyStats(readSamples),
    consistency: count === writers * opsPerWorker && ftsCount === count,
    note: "single-process, multiple connections; synchronous driver — no multi-core parallelism",
  };
}

export async function runConcurrencyBenchmark(dbPath: string): Promise<ConcurrencyResult[]> {
  const configs: Array<[number, number]> = [
    [1, 5],
    [1, 20],
    [5, 20],
  ];
  const results: ConcurrencyResult[] = [];
  for (const [w, r] of configs) {
    console.log(`  concurrency ${w}w/${r}r`);
    results.push(await runScenario(dbPath, w, r));
  }
  return results;
}
