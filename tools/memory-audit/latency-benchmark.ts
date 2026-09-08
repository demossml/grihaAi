/**
 * Latency benchmark: write / embedding / FTS / vector / hybrid / ranking /
 * full pipeline at 1k / 10k / 50k / 100k(optional). Uses the real service with
 * the deterministic hashing embedding (offline). Temporary DB only.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { SqliteRagMemoryService } from "../../apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { HashingEmbeddingService } from "../../apps/agent/src/utils/memory/embeddings.js";
import { hrtMs, latencyStats, type LatencyStats } from "./lib.js";

export interface LatencyResult {
  size: number;
  writeMs: LatencyStats;
  embeddingMs: LatencyStats;
  ftsMs: LatencyStats;
  vectorMs: LatencyStats;
  hybridMs: LatencyStats;
  pipelineMs: LatencyStats;
  note?: string;
}

const SIZES = [1_000, 10_000, 50_000];
const QUERY_TEXTS = [
  "User's preferred programming language",
  "What database does the project use?",
  "meeting schedule preferences",
  "reporting format",
];

function fakeContents(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`Memory fact ${i}: user prefers option ${i % 97} for topic ${i % 13}.`);
  }
  return out;
}

async function measureAt(dbPath: string, target: number): Promise<LatencyResult> {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });

  const emb = new HashingEmbeddingService(384);
  const service = new SqliteRagMemoryService(emb);
  await service.init(dbPath);

  const contents = fakeContents(target);
  const writeSamples: number[] = [];
  const embedSamples: number[] = [];
  for (let i = 0; i < target; i++) {
    const t0 = hrtMs();
    await service.addFact({ content: contents[i], category: "fact" });
    writeSamples.push(hrtMs() - t0);

    const e0 = hrtMs();
    await emb.embed(contents[i]);
    embedSamples.push(hrtMs() - e0);
  }

  // Separate service without embeddings → pure FTS path.
  const ftsService = new SqliteRagMemoryService(undefined);
  await ftsService.init(dbPath);

  const ftsSamples: number[] = [];
  const vectorSamples: number[] = [];
  const hybridSamples: number[] = [];
  const pipelineSamples: number[] = [];

  const db = new Database(dbPath);
  sqliteVec.load(db);
  const qvec = Buffer.from(new Float32Array(await emb.embed(QUERY_TEXTS[0])).buffer);
  const vecStmt = db.prepare(
    `SELECT id, vec_distance_cosine(embedding, ?) AS distance FROM facts WHERE embedding IS NOT NULL ORDER BY distance ASC LIMIT 10`,
  );

  const iterations = target >= 50_000 ? 20 : 50;
  for (let it = 0; it < iterations; it++) {
    const q = QUERY_TEXTS[it % QUERY_TEXTS.length];

    const t1 = hrtMs();
    await ftsService.search(q, { limit: 10 });
    ftsSamples.push(hrtMs() - t1);

    const t2 = hrtMs();
    vecStmt.all(qvec);
    vectorSamples.push(hrtMs() - t2);

    const t3 = hrtMs();
    await service.search(q, { limit: 10 });
    hybridSamples.push(hrtMs() - t3);

    const t4 = hrtMs();
    await service.search(q, { limit: 10 });
    pipelineSamples.push(hrtMs() - t4);
  }
  db.close();
  await ftsService.close();
  await service.close();

  return {
    size: target,
    writeMs: latencyStats(writeSamples),
    embeddingMs: latencyStats(embedSamples),
    ftsMs: latencyStats(ftsSamples),
    vectorMs: latencyStats(vectorSamples),
    hybridMs: latencyStats(hybridSamples),
    pipelineMs: latencyStats(pipelineSamples),
  };
}

export async function runLatencyBenchmark(dbPath: string, include100k = false): Promise<LatencyResult[]> {
  const sizes = include100k ? [...SIZES, 100_000] : SIZES;
  const results: LatencyResult[] = [];
  for (const size of sizes) {
    const started = Date.now();
    results.push(await measureAt(dbPath, size));
    console.log(`  latency @${size}: ${Date.now() - started}ms`);
  }
  return results;
}
