/**
 * Prompt 04 — RetrievalTrace: наблюдаемость retrieval/memory.
 *
 * Цель: различать три причины ошибки:
 *   1) нужная информация вообще не найдена (empty/irrelevant);
 *   2) найдена, но не попала в context;
 *   3) попала в context, но модель её неправильно использовала.
 *
 * Храним только ID + counts + latency; НЕ гигантские payloads кандидатов.
 * Сырой query не храним — только хэш (sha256, 16 hex).
 */
import { createHash } from "node:crypto";

export type RetrievalQueryType = "memory" | "semantic" | "keyword" | "other";

export interface RetrievalTrace {
  queryId: string;
  queryType: RetrievalQueryType;
  queryTextHash?: string;
  candidatesCount: number;
  selectedCount: number;
  selectedSourceIds: string[];
  durationMs: number;
  tokenEstimate?: number;
}

/** Короткий sha256-хэш текста запроса (не храним сырой текст). */
export function hashQueryText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function buildRetrievalTrace(input: {
  queryId: string;
  queryType: RetrievalQueryType;
  queryText?: string;
  candidatesCount: number;
  selectedSourceIds: string[];
  durationMs: number;
  tokenEstimate?: number;
}): RetrievalTrace {
  return {
    queryId: input.queryId,
    queryType: input.queryType,
    queryTextHash: input.queryText ? hashQueryText(input.queryText) : undefined,
    candidatesCount: input.candidatesCount,
    selectedCount: input.selectedSourceIds.length,
    selectedSourceIds: input.selectedSourceIds,
    durationMs: input.durationMs,
    tokenEstimate: input.tokenEstimate,
  };
}
