/**
 * Phase 3 — Context Engine публичный API (чистые функции).
 * Ничего не подключено к production-путям.
 */
export {
  estimateMessageTokens,
  estimateTokens,
  getActualUsage,
  usableBudget,
  type ChatMessage,
  type ContextBudget,
  type ProviderUsageAnchor,
} from "./usage.js";
export {
  DEFAULT_COMPACTION_POLICY,
  shouldCompress,
  type CompactionDecision,
  type CompactionLevel,
  type CompactionPolicy,
  type UsageState,
} from "./compaction.js";
export {
  DEFAULT_TOOL_RESULT_POLICY,
  isToolResult,
  pruneToolResults,
  type ToolResultPolicy,
} from "./prune.js";
export {
  compactContext,
  compactContextAsync,
  type CompactContextAsyncOptions,
  type CompactContextOptions,
  type CompactContextResult,
  type CompactionPhaseRecord,
} from "./pipeline.js";
export {
  CONTEXT_PRIORITY,
  SUMMARY_VERSION,
  emptySummary,
  extractSummarySections,
  mergeSummaries,
  persistSummary,
  preserveRecentTurns,
  preserveSystemContext,
  renderSummary,
  restoreSummary,
  summarizeMiddle,
  type ContextPriorityKind,
  type PersistedSummary,
  type SummarySections,
} from "./summary.js";
