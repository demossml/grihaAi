/**
 * Idempotency + deletion tests (temporary DB only).
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/embeddings.js";

export interface IdempotencyResult {
  writes: number;
  factRows: number;
  ftsRows: number;
  embeddingRows: number;
  note: string;
}

export interface DeletionResult {
  name: string;
  status: "PASS" | "FAIL" | "NOT IMPLEMENTED";
  detail: string;
}

export async function runIdempotency(dbPath: string): Promise<IdempotencyResult[]> {
  const results: IdempotencyResult[] = [];
  for (const writes of [1, 5, 100]) {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    const service = new SqliteRagMemoryService(new HashingEmbeddingService(384));
    await service.init(dbPath);
    for (let i = 0; i < writes; i++) {
      await service.addFact({ content: "The same memory content, repeated.", category: "fact" });
    }
    const db = new Database(dbPath, { readonly: true });
    const factRows = (db.prepare(`SELECT count(*) c FROM facts`).get() as { c: number }).c;
    const ftsRows = (db.prepare(`SELECT count(*) c FROM facts_fts`).get() as { c: number }).c;
    const embeddingRows = (db.prepare(`SELECT count(*) c FROM facts WHERE embedding IS NOT NULL`).get() as { c: number }).c;
    db.close();
    await service.close();
    results.push({
      writes,
      factRows,
      ftsRows,
      embeddingRows,
      note: factRows === writes ? "no deduplication strategy — every write creates a new record/embedding/FTS row" : "unexpected",
    });
  }
  return results;
}

export async function runDeletionTests(dbPath: string): Promise<DeletionResult[]> {
  const results: DeletionResult[] = [];
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });

  const service = new SqliteRagMemoryService(new HashingEmbeddingService(384));
  await service.init(dbPath);
  const f1 = await service.addFact({ content: "delete me by id", category: "fact" });
  const f2 = await service.addFact({ content: "delete me by project", category: "fact", projectId: "p-del" });
  await service.addFact({ content: "keep me", category: "fact" });
  await service.addMessage({ sessionId: "s-del", role: "user", content: "delete by session" });

  // API check: no delete method exists.
  const apiHasDelete = typeof (service as unknown as Record<string, unknown>).deleteFact === "function";
  results.push({
    name: "delete-api",
    status: apiHasDelete ? "PASS" : "NOT IMPLEMENTED",
    detail: "MemoryService has NO delete/update API — deletion only possible via raw SQL",
  });

  const db = new Database(dbPath);

  // delete by id + FTS/embedding cleanup via triggers/row delete.
  db.prepare(`DELETE FROM facts WHERE id = ?`).run(f1.id);
  // "delete me by project" still contains the token "delete", so match counts are
  // misleading — compare total indexed-doc counts instead.
  const ftsRows = (db.prepare(`SELECT count(*) c FROM facts_fts`).get() as { c: number }).c;

  // delete by project (raw SQL).
  db.prepare(`DELETE FROM facts WHERE project_id = ?`).run("p-del");
  const ftsRowsAfterProject = (db.prepare(`SELECT count(*) c FROM facts_fts`).get() as { c: number }).c;

  // delete by session (messages, raw SQL).
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run("s-del");
  const msgFts = (db.prepare(`SELECT count(*) c FROM messages_fts`).get() as { c: number }).c;
  db.close();

  const afterId = await service.search("delete me by id", { limit: 10 });
  const afterProject = await service.search("delete me by project", { limit: 10 });
  const afterSession = await service.searchSessions("delete by session");
  await service.close();

  results.push({
    name: "delete-by-id",
    status: afterId.every((r) => r.id !== f1.id) && ftsRows === 2 ? "PASS" : "FAIL",
    detail: `search no longer returns id; fts rows=${ftsRows} (3 inserted, 1 deleted)`,
  });
  results.push({
    name: "delete-by-project",
    status: afterProject.every((r) => r.id !== f2.id) && ftsRowsAfterProject === 1 ? "PASS" : "FAIL",
    detail: `raw DELETE + FTS trigger removes the record from index; fts rows=${ftsRowsAfterProject}`,
  });
  results.push({
    name: "delete-by-session",
    status: afterSession.length === 0 && msgFts === 0 ? "PASS" : "FAIL",
    detail: `messages + FTS cleaned; fts matches=${msgFts}`,
  });

  return results;
}
