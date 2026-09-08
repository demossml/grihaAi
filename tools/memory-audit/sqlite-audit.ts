/**
 * SQLite database audit: PRAGMAs, schema, EXPLAIN QUERY PLAN on the temp
 * benchmark DB, plus read-only introspection of a production DB if present.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface SqliteAuditResult {
  pragmas: Record<string, string>;
  tables: string[];
  explainFts: string[];
  explainVector: string[];
  production: { found: boolean; path: string; tables: Record<string, number> } | null;
}

export function runSqliteAudit(dbPath: string): SqliteAuditResult {
  const db = new Database(dbPath, { readonly: true });
  try {
    sqliteVec.load(db);
  } catch {
    // EXPLAIN для vector-запроса останется "not available".
  }

  const pragmas: Record<string, string> = {};
  for (const p of ["journal_mode", "synchronous", "busy_timeout", "cache_size", "page_size", "auto_vacuum", "mmap_size"]) {
    try {
      const row = db.pragma(p as never, { simple: true }) as unknown;
      pragmas[p] = String(row);
    } catch {
      pragmas[p] = "n/a";
    }
  }

  const tables = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`).all() as Array<{ name: string }>
  ).map((r) => r.name);

  let explainFts: string[] = [];
  try {
    const q = db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT f.id FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid
       WHERE facts_fts MATCH '"test"*' ORDER BY -bm25(facts_fts) DESC LIMIT 10`,
    );
    explainFts = (q.all() as Array<{ detail: string }>).map((r) => r.detail);
  } catch {
    explainFts = ["not available"];
  }

  let explainVector: string[] = [];
  try {
    const q = db.prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM facts WHERE embedding IS NOT NULL
       ORDER BY vec_distance_cosine(embedding, X'00000000') ASC LIMIT 10`,
    );
    explainVector = (q.all() as Array<{ detail: string }>).map((r) => r.detail);
  } catch {
    explainVector = ["not available"];
  }
  db.close();

  // Read-only introspection of a real production DB, if present on this machine.
  let production: SqliteAuditResult["production"] = null;
  const prodPath = path.join(os.homedir(), ".grish-ai", "memory.sqlite");
  if (fs.existsSync(prodPath)) {
    try {
      const pdb = new Database(prodPath, { readonly: true, fileMustExist: true });
      const tablesCount: Record<string, number> = {};
      const names = (
        pdb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
      ).map((r) => r.name);
      for (const n of names) {
        if (n.startsWith("sqlite_")) continue;
        try {
          tablesCount[n] = (pdb.prepare(`SELECT count(*) c FROM "${n}"`).get() as { c: number }).c;
        } catch {
          tablesCount[n] = -1;
        }
      }
      pdb.close();
      production = { found: true, path: prodPath, tables: tablesCount };
    } catch (err) {
      production = { found: false, path: prodPath, tables: {} };
      void err;
    }
  }

  return { pragmas, tables, explainFts, explainVector, production };
}
