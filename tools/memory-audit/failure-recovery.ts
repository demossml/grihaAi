/**
 * Failure / recovery tests (temporary DB only). Checks whether memory can end
 * up in a partial state after: interrupted write, rollback, embedding failure,
 * duplicate insertion, malformed metadata, missing/corrupted embedding,
 * failed retrieval, SQLite restart.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/embeddings.js";

export interface FailureTestResult {
  name: string;
  status: "PASS" | "FAIL" | "NOT APPLICABLE";
  detail: string;
}

async function fresh(dbPath: string): Promise<void> {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}

export async function runFailureRecovery(dbPath: string): Promise<FailureTestResult[]> {
  const results: FailureTestResult[] = [];
  const emb = new HashingEmbeddingService(384);

  // 1. Transaction rollback → no row, no FTS entry.
  await fresh(dbPath);
  {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, content TEXT)`);
    db.exec(`CREATE VIRTUAL TABLE t_fts USING fts5(content, content='t', content_rowid='rowid')`);
    db.exec(`CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN INSERT INTO t_fts(rowid, content) VALUES (new.rowid, new.content); END`);
    db.prepare(`BEGIN`).run();
    db.prepare(`INSERT INTO t (content) VALUES ('x')`).run();
    db.prepare(`ROLLBACK`).run();
    const rows = (db.prepare(`SELECT count(*) c FROM t`).get() as { c: number }).c;
    const ftsRows = (db.prepare(`SELECT count(*) c FROM t_fts`).get() as { c: number }).c;
    db.close();
    results.push({
      name: "transaction-rollback",
      status: rows === 0 && ftsRows === 0 ? "PASS" : "FAIL",
      detail: `rows=${rows}, fts=${ftsRows}`,
    });
  }

  // 2. Interrupted write (connection closed inside a transaction) → WAL rollback.
  await fresh(dbPath);
  {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, content TEXT)`);
    db.prepare(`BEGIN`).run();
    db.prepare(`INSERT INTO t (content) VALUES ('interrupted')`).run();
    db.close(); // no COMMIT
    const db2 = new Database(dbPath);
    const rows = (db2.prepare(`SELECT count(*) c FROM t`).get() as { c: number }).c;
    db2.close();
    results.push({
      name: "interrupted-write",
      status: rows === 0 ? "PASS" : "FAIL",
      detail: `rows after reopen=${rows}`,
    });
  }

  // 3. Embedding failure → no partial row.
  await fresh(dbPath);
  {
    const failing = {
      embed: async () => {
        throw new Error("embedding backend down");
      },
    };
    const service = new SqliteRagMemoryService(failing);
    await service.init(dbPath);
    let threw = false;
    try {
      await service.addFact({ content: "hello", category: "fact" });
    } catch {
      threw = true;
    }
    const db = new Database(dbPath, { readonly: true });
    const rows = (db.prepare(`SELECT count(*) c FROM facts`).get() as { c: number }).c;
    db.close();
    await service.close();
    results.push({
      name: "embedding-failure",
      status: threw && rows === 0 ? "PASS" : "FAIL",
      detail: `threw=${threw}, rows=${rows}`,
    });
  }

  // 4. Duplicate insertion (same content) → allowed, no dedup.
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    await service.init(dbPath);
    await service.addFact({ content: "dup", category: "fact" });
    await service.addFact({ content: "dup", category: "fact" });
    const db = new Database(dbPath, { readonly: true });
    const rows = (db.prepare(`SELECT count(*) c FROM facts`).get() as { c: number }).c;
    db.close();
    await service.close();
    results.push({
      name: "duplicate-insertion",
      status: rows === 2 ? "PASS" : "FAIL",
      detail: `rows=${rows} — duplicates are NOT deduplicated by design`,
    });
  }

  // 5. Malformed metadata (raw SQL) → read path throws on JSON.parse.
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    await service.init(dbPath);
    const fact = await service.addFact({ content: "meta", category: "fact" });
    const db = new Database(dbPath);
    db.prepare(`UPDATE facts SET metadata = 'not-json' WHERE id = ?`).run(fact.id);
    db.close();
    let threw = false;
    try {
      await service.listRecentFacts(10);
    } catch {
      threw = true;
    }
    await service.close();
    results.push({
      name: "malformed-metadata",
      status: threw ? "FAIL" : "PASS",
      detail: threw
        ? "READ PATH THROWS on malformed metadata — partial state is possible via raw SQL"
        : "no issue",
    });
  }

  // 6. Missing embedding → skipped by vector, retrievable via FTS; reembedMissing fixes.
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    await service.init(dbPath);
    const fact = await service.addFact({ content: "needle phrase here", category: "fact" });
    const db = new Database(dbPath);
    db.prepare(`UPDATE facts SET embedding = NULL WHERE id = ?`).run(fact.id);
    db.close();
    const hits = await service.search("needle phrase", { limit: 10 });
    const reembedded = await service.reembedMissing();
    const hitsAfter = await service.search("needle phrase", { limit: 10 });
    await service.close();
    results.push({
      name: "missing-embedding",
      status: hits.some((h) => h.id === fact.id) && reembedded === 1 && hitsAfter.some((h) => h.id === fact.id) ? "PASS" : "FAIL",
      detail: `fts-hit=${hits.some((h) => h.id === fact.id)}, reembedded=${reembedded}`,
    });
  }

  // 7. Corrupted embedding blob → vec_distance_cosine errors the whole query.
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    await service.init(dbPath);
    const fact = await service.addFact({ content: "corrupted vector test", category: "fact" });
    const db = new Database(dbPath);
    db.prepare(`UPDATE facts SET embedding = X'0102030405' WHERE id = ?`).run(fact.id);
    db.close();
    let threw = false;
    try {
      await service.search("corrupted vector test", { limit: 10 });
    } catch {
      threw = true;
    }
    await service.close();
    results.push({
      name: "corrupted-embedding",
      status: threw ? "FAIL" : "PASS",
      detail: threw
        ? "one corrupted BLOB breaks the ENTIRE vector search query"
        : "no issue",
    });
  }

  // 8. Failed retrieval (search before init).
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    let threw = false;
    try {
      await service.search("x");
    } catch {
      threw = true;
    }
    results.push({
      name: "failed-retrieval",
      status: threw ? "PASS" : "FAIL",
      detail: "search before init throws with clear message",
    });
  }

  // 9. SQLite restart (close/reopen) → data intact, WAL recovered.
  await fresh(dbPath);
  {
    const service = new SqliteRagMemoryService(emb);
    await service.init(dbPath);
    await service.addFact({ content: "restart test", category: "fact" });
    await service.close();

    const service2 = new SqliteRagMemoryService(emb);
    await service2.init(dbPath);
    const hits = await service2.search("restart test", { limit: 5 });
    await service2.close();
    results.push({
      name: "sqlite-restart",
      status: hits.length > 0 ? "PASS" : "FAIL",
      detail: `hits=${hits.length}`,
    });
  }

  return results;
}
