/**
 * Phase 4 (Item 4.2, матрица D3) — session summaries store.
 *
 * Hermes: summaries сессий. Контракт + in-memory реализация; upsert мержит
 * с прошлым summary через `mergeSummaries` (итеративная ре-компрессия, C4).
 * SQLite-wiring — за флагом `HERMES_AGENT_RUNTIME`.
 */
import { mergeSummaries, renderSummary, type SummarySections } from "../context/summary.js";

export interface SessionSummaryEntry {
  sessionId: string;
  updatedAt: string;
  sections: SummarySections;
}

export interface SessionSummaryStore {
  upsert(sessionId: string, sections: SummarySections, updatedAt?: string): SessionSummaryEntry;
  get(sessionId: string): SessionSummaryEntry | undefined;
  list(): SessionSummaryEntry[];
  delete(sessionId: string): boolean;
  size(): number;
}

export class InMemorySessionSummaryStore implements SessionSummaryStore {
  private readonly entries = new Map<string, SessionSummaryEntry>();

  upsert(sessionId: string, sections: SummarySections, updatedAt?: string): SessionSummaryEntry {
    const prev = this.entries.get(sessionId);
    const merged = prev ? mergeSummaries(prev.sections, sections) : sections;
    const entry: SessionSummaryEntry = {
      sessionId,
      updatedAt: updatedAt ?? new Date().toISOString(),
      sections: merged,
    };
    this.entries.set(sessionId, entry);
    return entry;
  }

  get(sessionId: string): SessionSummaryEntry | undefined {
    return this.entries.get(sessionId);
  }

  list(): SessionSummaryEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  delete(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  size(): number {
    return this.entries.size;
  }
}

/** Структурированный рендер summary сессии (C4 renderSummary). */
export function renderSessionSummary(entry: SessionSummaryEntry): string {
  return renderSummary(entry.sections);
}
