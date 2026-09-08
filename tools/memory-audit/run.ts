/**
 * Memory audit orchestrator: runs every benchmark against TEMPORARY databases
 * and writes docs/archive/memory-audit-results.json. Production code/DB untouched.
 *
 *   npx tsx tools/memory-audit/run.ts            # core suite
 *   AUDIT_LARGE=1 npx tsx tools/memory-audit/run.ts  # +100k latency/storage
 */
import fs from "node:fs";
import path from "node:path";
import { cleanTmp, ensureTmpDir, DB_PATH, round } from "./lib.js";
import { buildDataset } from "./dataset.js";
import { runRetrievalBenchmark } from "./retrieval-benchmark.js";
import { runLatencyBenchmark } from "./latency-benchmark.js";
import { runStorageBenchmark } from "./storage-benchmark.js";
import { runConcurrencyBenchmark } from "./concurrency-benchmark.js";
import { runFailureRecovery } from "./failure-recovery.js";
import { runIdempotency, runDeletionTests } from "./idempotency-deletion.js";
import { runTemporalContradiction } from "./temporal-contradiction.js";
import { runSqliteAudit } from "./sqlite-audit.js";

const LARGE = process.env.AUDIT_LARGE === "1";

async function main(): Promise<void> {
  cleanTmp();
  ensureTmpDir();
  const started = Date.now();

  console.log("== dataset ==");
  const dataset = buildDataset();
  console.log(`  records=${dataset.records.length}, queries=${dataset.queries.length}`);

  console.log("== retrieval ==");
  const retrieval = await runRetrievalBenchmark(DB_PATH, dataset);

  console.log("== latency ==");
  const latency = await runLatencyBenchmark(DB_PATH, LARGE);

  console.log("== storage (10k" + (LARGE ? " + 100k" : "") + ") ==");
  const storage10k = await runStorageBenchmark(DB_PATH, 10_000);
  const storage100k = LARGE ? await runStorageBenchmark(DB_PATH, 100_000) : null;

  console.log("== concurrency ==");
  const concurrency = await runConcurrencyBenchmark(DB_PATH);

  console.log("== failure/recovery ==");
  const failures = await runFailureRecovery(DB_PATH);

  console.log("== idempotency ==");
  const idempotency = await runIdempotency(DB_PATH);

  console.log("== deletion ==");
  const deletion = await runDeletionTests(DB_PATH);

  console.log("== temporal/contradiction ==");
  const temporal = await runTemporalContradiction(DB_PATH);

  console.log("== sqlite audit ==");
  const audit = runSqliteAudit(DB_PATH);

  const results = {
    meta: {
      generatedAt: new Date().toISOString(),
      commitSha: process.env.AUDIT_SHA ?? "see repo git log",
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      sqlite: "3.53.4 (better-sqlite3 13.0.3)",
      sqliteVec: "0.1.9",
      embeddingBackend: "HashingEmbeddingService dim=384 (offline fallback; no HTTP embedding configured in this environment)",
    },
    benchmark: {
      datasetSize: retrieval.datasetSize,
      queryCount: retrieval.queryCount,
      durationMs: Date.now() - started,
    },
    retrieval: {
      recallAt1: round(retrieval.overall.recallAt1),
      recallAt5: round(retrieval.overall.recallAt5),
      recallAt10: round(retrieval.overall.recallAt10),
      mrr: round(retrieval.overall.mrr),
      precisionAt5: round(retrieval.overall.precisionAt5),
      precisionAt10: round(retrieval.overall.precisionAt10),
      ndcgAt10: round(retrieval.overall.ndcgAt10),
      perKind: Object.fromEntries(
        Object.entries(retrieval.perKind).map(([k, m]) => [k, { ...m }]),
      ),
    },
    latency: latency.map((l) => ({ ...l })),
    storage: { storage10k, storage100k },
    concurrency,
    failures,
    idempotency,
    deletion,
    temporal: temporal.temporal,
    contradiction: temporal.contradiction,
    sqliteAudit: audit,
    candidates: {
      sqliteRag: { status: "NOT TESTED (research-only, no runtime benchmark)" },
      sqliteVector: { status: "NOT TESTED (isolated benchmark not run — see report)" },
      sqliteMemory: { status: "NOT TESTED (research-only)" },
      sqliteAi: { status: "NOT TESTED (research-only)" },
    },
  };

  const outDir = path.join(process.cwd(), "docs", "archive");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "memory-audit-results.json"),
    JSON.stringify(results, null, 2),
    "utf8",
  );
  console.log("\n== RESULTS ==");
  console.log(JSON.stringify({
    retrieval: results.retrieval,
    latency: latency.map((l) => ({ size: l.size, avg: l.hybridMs.avg, p50: l.hybridMs.p50, p95: l.hybridMs.p95, p99: l.hybridMs.p99 })),
    storage: results.storage.storage10k,
    concurrency: concurrency.map((c) => ({ w: c.writers, r: c.readers, busy: c.busyErrors, locked: c.lockedErrors, consistent: c.consistency })),
    contradiction: temporal.contradiction,
  }, null, 2));

  console.log("wrote docs/archive/memory-audit-results.json");
  cleanTmp();
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
