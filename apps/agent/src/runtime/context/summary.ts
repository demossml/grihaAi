/**
 * Phase 3 (Item 3.4, матрица C4) — preserve + структурированный summary.
 *
 * Контракт §8 master spec: preserveSystemContext(), preserveRecentTurns(),
 * summarizeMiddle(), persistSummary(), restoreSummary().
 * Приоритет контекста §8 (system → security → task → recent → memory →
 * skills → history) — константой CONTEXT_PRIORITY.
 *
 * Резюмирование — структурное (шаблон), механическое извлечение; LLM-модель
 * компрессии (B5) подключается позже.
 */
import type { ChatMessage } from "./usage.js";

export type { ChatMessage };

/** Приоритет контекста из §8 master spec. */
export const CONTEXT_PRIORITY = [
  "system",
  "security",
  "task",
  "recent",
  "memory",
  "skills",
  "history",
] as const;

export type ContextPriorityKind = (typeof CONTEXT_PRIORITY)[number];

export interface SummarySections {
  goal?: string;
  progress?: string;
  decisions: string[];
  openQuestions: string[];
}

export const SUMMARY_VERSION = 1;

export interface PersistedSummary {
  version: typeof SUMMARY_VERSION;
  sections: SummarySections;
}

/** Head: system-сообщения (инструкции + security policy). */
export function preserveSystemContext(messages: ChatMessage[]): ChatMessage[] {
  const head: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") head.push(m);
    else break;
  }
  return head;
}

/** Tail: последние n turns (turn = user+assistant), точнее последние 2n сообщений. */
export function preserveRecentTurns(messages: ChatMessage[], turns: number): ChatMessage[] {
  if (turns <= 0) return [];
  return messages.slice(-turns * 2);
}

const DECISION_PATTERN = /^(decision|решение)\s*[:：]/i;
const QUESTION_PATTERN = /\?\s*$/;

/** Механическое извлечение секций из «середины» (placeholder до B5-модели). */
export function extractSummarySections(middle: ChatMessage[]): SummarySections {
  const decisions: string[] = [];
  const openQuestions: string[] = [];
  let goal: string | undefined;
  let progress: string | undefined;
  const userMessages = middle.filter((m) => m.role === "user");
  if (userMessages.length > 0) goal = userMessages[0].content.slice(0, 200);
  const lastAssistant = [...middle].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) progress = lastAssistant.content.slice(0, 200);
  for (const m of middle) {
    for (const line of m.content.split("\n")) {
      if (DECISION_PATTERN.test(line)) decisions.push(line.slice(line.indexOf(":") + 1).trim());
      if (m.role === "user" && QUESTION_PATTERN.test(line.trim())) {
        openQuestions.push(line.trim());
      }
    }
  }
  return { goal, progress, decisions, openQuestions };
}

/** Разбиение: head (system) | middle (к резюмированию) | tail (recent). */
export function summarizeMiddle(
  messages: ChatMessage[],
  options: { recentTurns?: number } = {},
): {
  head: ChatMessage[];
  middle: ChatMessage[];
  tail: ChatMessage[];
  summary: SummarySections;
} {
  const head = preserveSystemContext(messages);
  const recentTurns = options.recentTurns ?? 4;
  const tail = preserveRecentTurns(messages, recentTurns);
  const tailStart = Math.max(head.length, messages.length - tail.length);
  const middle = messages.slice(head.length, tailStart);
  return { head, middle, tail, summary: extractSummarySections(middle) };
}

/** Структурированный markdown: Goal/Progress/Decisions/Open Questions. */
export function renderSummary(sections: SummarySections): string {
  const parts: string[] = [];
  if (sections.goal) parts.push(`## Goal\n${sections.goal}`);
  if (sections.progress) parts.push(`## Progress\n${sections.progress}`);
  if (sections.decisions.length > 0) {
    parts.push(`## Decisions\n${sections.decisions.map((d) => `- ${d}`).join("\n")}`);
  }
  if (sections.openQuestions.length > 0) {
    parts.push(
      `## Open Questions\n${sections.openQuestions.map((q) => `- ${q}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

/** Итеративная ре-компрессия: новый goal/прогресс выигрывает, решения — дедуп. */
export function mergeSummaries(prev: SummarySections, curr: SummarySections): SummarySections {
  const decisions: string[] = [];
  for (const d of [...prev.decisions, ...curr.decisions]) {
    if (!decisions.includes(d)) decisions.push(d);
  }
  const openQuestions: string[] = [];
  for (const q of [...prev.openQuestions, ...curr.openQuestions]) {
    if (!openQuestions.includes(q)) openQuestions.push(q);
  }
  return {
    goal: curr.goal ?? prev.goal,
    progress: curr.progress ?? prev.progress,
    decisions,
    openQuestions,
  };
}

/** Сериализация summary (wiring в SQLite — позже). */
export function persistSummary(sections: SummarySections): string {
  const payload: PersistedSummary = { version: SUMMARY_VERSION, sections };
  return JSON.stringify(payload);
}

/** Восстановление summary; некорректный ввод → пустые секции (не бросает). */
export function restoreSummary(serialized: string): SummarySections {
  try {
    const parsed = JSON.parse(serialized) as PersistedSummary;
    if (parsed?.version === SUMMARY_VERSION && parsed.sections) return parsed.sections;
    return emptySummary();
  } catch {
    return emptySummary();
  }
}

export function emptySummary(): SummarySections {
  return { decisions: [], openQuestions: [] };
}
