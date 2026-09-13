/**
 * Phase 4 — Session Engine публичный API (чистые функции).
 * Ничего не подключено к production-путям.
 */
export {
  buildScrollCursor,
  parseScrollCursor,
  sliceByCursor,
  sqlOffsetFor,
  type ScrollCursorData,
  type ScrollPage,
} from "./scroll.js";
export {
  InMemorySessionSummaryStore,
  renderSessionSummary,
  type SessionSummaryEntry,
  type SessionSummaryStore,
} from "./summaries.js";
export {
  DEFAULT_RRF_K,
  rankedById,
  rrfMerge,
  rrfScore,
  type RankedItem,
} from "./rrf.js";
