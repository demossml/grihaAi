/**
 * Shared helpers for the memory audit benchmarks.
 * This code lives in tools/ and is never imported by production code.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const TMP_DIR = path.join(os.tmpdir(), "griha-memory-audit");
export const DB_PATH = path.join(TMP_DIR, "memory.sqlite");

export function ensureTmpDir(): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

export function cleanTmp(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

/** Deterministic PRNG (mulberry32) — benchmarks must be reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hrtMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

export interface LatencyStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  n: number;
}

export function latencyStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx] ?? 0;
  };
  const sum = samples.reduce((s, v) => s + v, 0);
  return {
    avg: samples.length ? sum / samples.length : 0,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    n: samples.length,
  };
}

export function round(v: number, digits = 4): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

export interface RetrievalMetrics {
  queries: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  precisionAt5: number;
  precisionAt10: number;
  ndcgAt10: number;
}

function dcg(relevantAtRank: boolean[], k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(k, relevantAtRank.length); i++) {
    if (relevantAtRank[i]) sum += 1 / Math.log2(i + 2);
  }
  return sum;
}

export function computeMetrics(
  runs: Array<{ retrieved: string[]; relevant: string[] }>,
): RetrievalMetrics {
  let recall1 = 0;
  let recall5 = 0;
  let recall10 = 0;
  let mrr = 0;
  let p5 = 0;
  let p10 = 0;
  let ndcg = 0;

  for (const run of runs) {
    const rel = new Set(run.relevant);
    if (rel.size === 0) continue;
    const hit = (k: number) =>
      run.retrieved.slice(0, k).filter((id) => rel.has(id)).length / rel.size;

    recall1 += hit(1);
    recall5 += hit(5);
    recall10 += hit(10);

    let rr = 0;
    for (let i = 0; i < run.retrieved.length; i++) {
      if (rel.has(run.retrieved[i])) {
        rr = 1 / (i + 1);
        break;
      }
    }
    mrr += rr;

    p5 += run.retrieved.slice(0, 5).filter((id) => rel.has(id)).length / 5;
    p10 += run.retrieved.slice(0, 10).filter((id) => rel.has(id)).length / 10;

    const ideal = Math.min(10, rel.size);
    const idealDcg = dcg(new Array(ideal).fill(true), 10);
    const actualDcg = dcg(
      run.retrieved.slice(0, 10).map((id) => rel.has(id)),
      10,
    );
    ndcg += idealDcg > 0 ? actualDcg / idealDcg : 0;
  }

  const n = runs.length;
  return {
    queries: n,
    recallAt1: n ? recall1 / n : 0,
    recallAt5: n ? recall5 / n : 0,
    recallAt10: n ? recall10 / n : 0,
    mrr: n ? mrr / n : 0,
    precisionAt5: n ? p5 / n : 0,
    precisionAt10: n ? p10 / n : 0,
    ndcgAt10: n ? ndcg / n : 0,
  };
}
