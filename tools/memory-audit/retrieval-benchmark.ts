/**
 * Retrieval benchmark: inserts the synthetic dataset into a temporary DB via
 * the REAL SqliteRagMemoryService and measures Recall/Precision/MRR/nDCG per
 * query category. No production code is modified; no production DB is touched.
 */
import Database from "better-sqlite3";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/embeddings.js";
import { buildDataset, type Dataset, type DatasetQuery } from "./dataset.js";
import { computeMetrics, type RetrievalMetrics } from "./lib.js";

export interface RetrievalBenchmarkResult {
  datasetSize: number;
  queryCount: number;
  embedding: "hashing-384 (offline fallback)";
  overall: RetrievalMetrics;
  perKind: Record<string, RetrievalMetrics>;
}

export async function runRetrievalBenchmark(
  dbPath: string,
  dataset: Dataset = buildDataset(),
): Promise<RetrievalBenchmarkResult> {
  const service = new SqliteRagMemoryService(new HashingEmbeddingService(384));
  await service.init(dbPath);

  const keyToId = new Map<string, string>();
  const idToKey = new Map<string, string>();

  for (const r of dataset.records) {
    const fact = await service.addFact({
      content: r.content,
      category: r.category as never,
      projectId: r.projectId,
      botId: r.botId,
      metadata: r.metadata,
    });
    keyToId.set(r.key, fact.id);
    idToKey.set(fact.id, r.key);
  }

  // Apply date overrides (temporal/contradiction facts) via raw SQL — the
  // service API has no date parameter, so this mirrors reality: dates come
  // from created_at/updated_at only.
  {
    const db = new Database(dbPath);
    const update = db.prepare(`UPDATE facts SET created_at = ?, updated_at = ? WHERE id = ?`);
    for (const r of dataset.records) {
      if (r.date) {
        const id = keyToId.get(r.key);
        if (id) update.run(r.date, r.date, id);
      }
    }
    db.close();
  }

  const runsByKind = new Map<string, Array<{ retrieved: string[]; relevant: string[] }>>();

  for (const q of dataset.queries) {
    const results = await service.search(q.query, {
      limit: 10,
      projectId: q.filters?.projectId,
      category: q.filters?.category,
    });
    // Both sides are record KEYS (stable ground truth; ids are UUIDs).
    const retrieved = results.map((r) => idToKey.get(r.id) ?? r.id);
    const relevant = q.relevant;
    const run = { retrieved, relevant };
    const list = runsByKind.get(q.kind) ?? [];
    list.push(run);
    runsByKind.set(q.kind, list);
  }

  const perKind: Record<string, RetrievalMetrics> = {};
  for (const [kind, runs] of runsByKind) {
    perKind[kind] = computeMetrics(runs);
  }
  const overall = computeMetrics([...runsByKind.values()].flat());

  await service.close();

  return {
    datasetSize: dataset.records.length,
    queryCount: dataset.queries.length,
    embedding: "hashing-384 (offline fallback)",
    overall,
    perKind,
  };
}

export type { Dataset, DatasetQuery };
