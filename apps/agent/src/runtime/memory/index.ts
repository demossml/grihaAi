/**
 * Phase 5 — Memory Engine публичный API (контракты §10 + чистые функции).
 * Ничего не подключено к production-путям.
 */
export type {
  MemoryCriteria,
  MemoryEngine,
  MemoryInput,
  MemoryQuery,
  MemoryRecord,
  MemoryStatus,
  MemoryType,
} from "./types.js";
export {
  DEFAULT_PIPELINE_POLICY,
  decidePersist,
  detectConflict,
  evaluateCandidate,
  normalizeText,
  similarity,
  type PersistAction,
  type PipelineDecision,
  type PipelinePolicy,
} from "./pipeline.js";
export { InMemoryMemoryStore, type MemoryStoreOptions } from "./store.js";
export {
  scanDecision,
  scanMemoryContent,
  type MemoryScanIssue,
} from "./scan.js";
