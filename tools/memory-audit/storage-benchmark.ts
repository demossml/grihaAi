/**
 * Storage benchmark: DB size, FTS overhead, embedding bytes, WAL size,
 * bytes-per-record. Temporary DB only.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/memory/embeddings.js";

export interface StorageResult {
  records: number;
  rawTextBytes: number;
  dbBytes: number;
  ftsBytes: number;
  embeddingBytes: number;
  walBytes: number;
  bytesPerRecord: number;
  factsOnlyBytes: number;
}

export async function runStorageBenchmark(dbPath: string, n = 10_000): Promise<StorageResult> {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(`${dbPath}.facts`, { force: true });

  const service = new SqliteRagMemoryService(new HashingEmbeddingService(384));
  await service.init(dbPath);

  let rawTextBytes = 0;
  for (let i = 0; i < n; i++) {
    const content = `Memory fact ${i}: user prefers option ${i % 97} for topic ${i % 13} with extra detail ${i}.`;
    rawTextBytes += Buffer.byteLength(content, "utf8");
    await service.addFact({ content, category: "fact" });
  }
  await service.close();

  // Parallel facts-only DB (no FTS/triggers/embeddings) → FTS+trigger overhead.
  const factsPath = `${dbPath}.facts`;
  const plain = new Database(factsPath);
  plain.pragma("journal_mode = WAL");
  plain.exec(`CREATE TABLE facts (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL,
    project_id TEXT, agent_id TEXT, bot_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata TEXT, embedding BLOB
  )`);
  const ins = plain.prepare(`INSERT INTO facts (id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < n; i++) {
    ins.run(`id-${i}`, `Memory fact ${i}: user prefers option ${i % 97} for topic ${i % 13} with extra detail ${i}.`, "fact", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z");
  }
  plain.close();

  const db = new Database(dbPath, { readonly: true });
  const embBytes = (db.prepare(`SELECT COALESCE(SUM(length(embedding)), 0) s FROM facts`).get() as { s: number }).s;
  db.close();

  const dbBytes = fs.statSync(dbPath).size;
  const walBytes = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0;
  const factsOnlyBytes = fs.statSync(factsPath).size;

  return {
    records: n,
    rawTextBytes,
    dbBytes,
    ftsBytes: dbBytes - factsOnlyBytes,
    embeddingBytes: embBytes,
    walBytes,
    bytesPerRecord: Math.round(dbBytes / n),
    factsOnlyBytes,
  };
}
