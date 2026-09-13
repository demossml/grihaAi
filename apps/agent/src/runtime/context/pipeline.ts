/**
 * Phase 3 (матрица C2) — 4-фазный конвейер компакции (§8 master spec).
 *
 * Hermes Phase 1–4:
 *  1) prune      — вычистить старые tool-результаты (политика C3);
 *  2) structural — head (system) | middle | tail (recent) (C4);
 *  3) summarize  — резюме середины: шаблон или LLM (aux B5, `models.compression`);
 *  4) merge      — итеративное слияние с предыдущим summary (persist/restore).
 *
 * Чистые функции с инъекцией политик; LLM-вариант — `compactContextAsync`.
 */
import type { ChatMessage } from "./usage.js";
import {
  DEFAULT_TOOL_RESULT_POLICY,
  pruneToolResults,
  type ToolResultPolicy,
} from "./prune.js";
import {
  emptySummary,
  extractSummarySections,
  mergeSummaries,
  preserveRecentTurns,
  preserveSystemContext,
  type SummarySections,
} from "./summary.js";

export interface CompactionPhaseRecord {
  phase: 1 | 2 | 3 | 4;
  name: "prune" | "structural" | "summarize" | "merge";
  detail: string;
}

export interface CompactContextOptions {
  /** Сколько последних turns держать в tail (Phase 2). Default 4. */
  recentTurns?: number;
  /** Политика Phase 1 (prune tool results). Default — DEFAULT_TOOL_RESULT_POLICY. */
  toolResultPolicy?: ToolResultPolicy;
  /** Предыдущее summary для итеративной ре-компрессии (Phase 4). */
  previousSummary?: SummarySections;
}

export interface CompactContextResult {
  head: ChatMessage[];
  tail: ChatMessage[];
  /** Число сообщений середины (отправленных в резюме). */
  middleCount: number;
  /** Сколько сообщений вычистила Phase 1. */
  prunedCount: number;
  /** Итоговые секции summary после слияния (Phase 4). */
  summary: SummarySections;
  /** Метрики по фазам (для observability/debug). */
  phases: CompactionPhaseRecord[];
}

function runPhases(
  messages: ChatMessage[],
  options: CompactContextOptions,
  current: SummarySections,
  summarizeDetail: string,
): CompactContextResult {
  const phases: CompactionPhaseRecord[] = [];
  // Phase 1: prune tool results (C3-политика).
  const policy = options.toolResultPolicy ?? DEFAULT_TOOL_RESULT_POLICY;
  const afterPrune = pruneToolResults(messages, policy);
  const prunedCount = messages.length - afterPrune.length;
  phases.push({ phase: 1, name: "prune", detail: `tool results: -${prunedCount}` });

  // Phase 2: структурное разбиение (preserveSystemContext / preserveRecentTurns).
  const head = preserveSystemContext(afterPrune);
  const tail = preserveRecentTurns(afterPrune, options.recentTurns ?? 4);
  const tailStart = Math.max(head.length, afterPrune.length - tail.length);
  const middle = afterPrune.slice(head.length, tailStart);
  phases.push({
    phase: 2,
    name: "structural",
    detail: `head ${head.length} | middle ${middle.length} | tail ${tail.length}`,
  });

  // Phase 3: резюме середины (шаблон или LLM).
  phases.push({ phase: 3, name: "summarize", detail: summarizeDetail });

  // Phase 4: итеративное слияние с предыдущим summary.
  const summary = mergeSummaries(options.previousSummary ?? emptySummary(), current);
  phases.push({ phase: 4, name: "merge", detail: `${summary.decisions.length} merged decisions` });

  return { head, tail, middleCount: middle.length, prunedCount, summary, phases };
}

/** Синхронный 4-фазный конвейер (Phase 3 — шаблонное резюме). */
export function compactContext(
  messages: ChatMessage[],
  options: CompactContextOptions = {},
): CompactContextResult {
  const afterPrune = pruneToolResults(
    messages,
    options.toolResultPolicy ?? DEFAULT_TOOL_RESULT_POLICY,
  );
  const head = preserveSystemContext(afterPrune);
  const tail = preserveRecentTurns(afterPrune, options.recentTurns ?? 4);
  const tailStart = Math.max(head.length, afterPrune.length - tail.length);
  const middle = afterPrune.slice(head.length, tailStart);
  const current = extractSummarySections(middle);
  return runPhases(messages, options, current, "template");
}

export interface CompactContextAsyncOptions extends CompactContextOptions {
  /** LLM-резюме Phase 3 (aux B5: `models.compression`). Без него — шаблон. */
  llmSummarize?: (middle: ChatMessage[]) => Promise<SummarySections>;
}

/** Асинхронный вариант: Phase 3 через LLM-колбэк (подключается за флагом). */
export async function compactContextAsync(
  messages: ChatMessage[],
  options: CompactContextAsyncOptions = {},
): Promise<CompactContextResult> {
  const afterPrune = pruneToolResults(
    messages,
    options.toolResultPolicy ?? DEFAULT_TOOL_RESULT_POLICY,
  );
  const head = preserveSystemContext(afterPrune);
  const tail = preserveRecentTurns(afterPrune, options.recentTurns ?? 4);
  const tailStart = Math.max(head.length, afterPrune.length - tail.length);
  const middle = afterPrune.slice(head.length, tailStart);
  const current = options.llmSummarize
    ? await options.llmSummarize(middle)
    : extractSummarySections(middle);
  return runPhases(messages, options, current, options.llmSummarize ? "LLM" : "template");
}
