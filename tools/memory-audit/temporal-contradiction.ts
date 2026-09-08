/**
 * Temporal correctness + contradiction tests (temporary DB only).
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/memory/embeddings.js";

export interface TemporalResult {
  scenario: string;
  query: string;
  top3: string[];
  note: string;
}

export interface ContradictionSummary {
  pairs: number;
  newerFirst: number;
  olderFirst: number;
  tie: number;
  note: string;
}

export async function runTemporalContradiction(dbPath: string): Promise<{
  temporal: TemporalResult[];
  contradiction: ContradictionSummary;
}> {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });

  const service = new SqliteRagMemoryService(new HashingEmbeddingService(384));
  await service.init(dbPath);

  // Canonical scenario: A (January, PostgreSQL) vs B (September, SQLite).
  const a = await service.addFact({ content: "User uses PostgreSQL as the main database.", category: "fact" });
  const b = await service.addFact({ content: "User migrated from PostgreSQL to SQLite in September.", category: "fact" });
  const db = new Database(dbPath);
  db.prepare(`UPDATE facts SET created_at = '2026-01-15', updated_at = '2026-01-15' WHERE id = ?`).run(a.id);
  db.prepare(`UPDATE facts SET created_at = '2026-09-15', updated_at = '2026-09-15' WHERE id = ?`).run(b.id);
  db.close();

  const q1 = await service.search("What database does the user currently use?", { limit: 10 });
  const idOf = (x: string) => (x === a.id ? "A(jan-postgres)" : x === b.id ? "B(sep-sqlite)" : x);
  const top3 = q1.slice(0, 3).map((r) => `${idOf(r.id)} [${r.source}]`);

  // 50 contradiction pairs.
  let newerFirst = 0;
  let olderFirst = 0;
  let tie = 0;
  for (let p = 0; p < 50; p++) {
    const oldF = await service.addFact({
      content: `User prefers vendor X${p} for category ${p}.`,
      category: "preference",
    });
    const newF = await service.addFact({
      content: `User switched from vendor X${p} to vendor Y${p} for category ${p}.`,
      category: "preference",
    });
    const d2 = new Database(dbPath);
    d2.prepare(`UPDATE facts SET created_at = '2026-01-15', updated_at = '2026-01-15' WHERE id = ?`).run(oldF.id);
    d2.prepare(`UPDATE facts SET created_at = '2026-09-15', updated_at = '2026-09-15' WHERE id = ?`).run(newF.id);
    d2.close();

    const res = await service.search(`What does the user currently use for category ${p}?`, { limit: 5 });
    const posOld = res.findIndex((r) => r.id === oldF.id);
    const posNew = res.findIndex((r) => r.id === newF.id);
    if (posNew >= 0 && (posOld < 0 || posNew < posOld)) newerFirst++;
    else if (posOld >= 0 && (posNew < 0 || posOld < posNew)) olderFirst++;
    else tie++;
  }

  await service.close();

  const posA = q1.findIndex((r) => r.id === a.id);
  const posB = q1.findIndex((r) => r.id === b.id);
  const temporalNote = `posA(jan-postgres)=${posA}, posB(sep-sqlite)=${posB}; ranking has NO time weighting — recency is not part of the score`;

  return {
    temporal: [
      {
        scenario: "PostgreSQL (Jan) → SQLite (Sep)",
        query: "What database does the user currently use?",
        top3,
        note: temporalNote,
      },
    ],
    contradiction: {
      pairs: 50,
      newerFirst,
      olderFirst,
      tie,
      note: "no explicit supersedes relation, no contradiction detection, no confidence in ranking",
    },
  };
}
