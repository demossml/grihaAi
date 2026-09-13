/**
 * Phase 5 (Item 5.2, матрица E5) — in-memory MemoryEngine.
 *
 * remember() прогоняет пайплайн candidate→confidence→conflict→persist:
 * - duplicate  → reinforce (confidence+1, capped 1.0, evidenceCount растёт);
 * - contradict → новая запись persist + старая помечается "contradicted";
 * - reject     → не пишется (возвращается причина).
 * Чистая реализация; SQLite-wiring — за флагом `HERMES_AGENT_RUNTIME`.
 */
import {
  decidePersist,
  type PipelinePolicy,
} from "./pipeline.js";
import type {
  MemoryCriteria,
  MemoryEngine,
  MemoryInput,
  MemoryQuery,
  MemoryRecord,
} from "./types.js";

export interface MemoryStoreOptions {
  policy?: PipelinePolicy;
  /** Генератор id (DI для тестов). */
  idFactory?: () => string;
  now?: () => string;
}

let seq = 0;
const defaultId = () => `mem-${++seq}`;

export class InMemoryMemoryStore implements MemoryEngine {
  private readonly records: MemoryRecord[] = [];
  private readonly policy?: PipelinePolicy;
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(options: MemoryStoreOptions = {}) {
    this.policy = options.policy;
    this.idFactory = options.idFactory ?? defaultId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async remember(input: MemoryInput): Promise<MemoryRecord> {
    const decision = this.policy
      ? decidePersist(input, this.records, this.policy)
      : decidePersist(input, this.records);
    const ts = this.now();
    if (decision.action === "reject") {
      throw new Error(`memory rejected: ${decision.reason}`);
    }
    if (decision.action === "reinforce") {
      const existing = this.records.find((r) => r.id === decision.conflictingId);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.1);
        existing.evidence = [...existing.evidence, ...(input.evidence ?? [])];
        existing.updatedAt = ts;
        return { ...existing };
      }
    }
    const record: MemoryRecord = {
      id: this.idFactory(),
      type: input.type,
      content: input.content,
      source: input.source,
      confidence: input.confidence,
      createdAt: ts,
      updatedAt: ts,
      evidence: input.evidence ?? [],
      status: input.confidence >= (this.policy?.confirmThreshold ?? 0.7) ? "confirmed" : "candidate",
      provenance: input.provenance ?? input.source,
    };
    this.records.push(record);
    if (decision.action === "contradict" && decision.conflictingId) {
      const existing = this.records.find((r) => r.id === decision.conflictingId);
      if (existing) existing.status = "contradicted";
    }
    return { ...record };
  }

  async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
    const text = query.text?.toLowerCase();
    return this.records.filter((r) => {
      if (query.type && r.type !== query.type) return false;
      if (query.status && r.status !== query.status) return false;
      if (text && !r.content.toLowerCase().includes(text)) return false;
      return true;
    });
  }

  async forget(criteria: MemoryCriteria): Promise<void> {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (criteria.id && r.id !== criteria.id) continue;
      if (criteria.type && r.type !== criteria.type) continue;
      if (criteria.status && r.status !== criteria.status) continue;
      this.records.splice(i, 1);
    }
  }

  async reinforce(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error(`memory record not found: ${id}`);
    record.confidence = Math.min(1, record.confidence + 0.1);
    record.updatedAt = this.now();
  }

  async contradict(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error(`memory record not found: ${id}`);
    record.status = "contradicted";
    record.updatedAt = this.now();
  }

  list(): MemoryRecord[] {
    return [...this.records];
  }
}
