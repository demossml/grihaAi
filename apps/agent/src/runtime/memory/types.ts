/**
 * Phase 5 (Item 5.2, матрица E5) — контракт §10 master spec.
 *
 * Единый MemoryEngine + типы записей. Чистые контракты; существующий
 * `SqliteRagMemoryService` не переключается.
 */

/** §10: разделение типов памяти. */
export type MemoryType =
  | "fact"
  | "preference"
  | "constraint"
  | "goal"
  | "workflow"
  | "episode"
  | "insight"
  | "lesson";

export type MemoryStatus = "candidate" | "confirmed" | "deprecated" | "contradicted";

/** §10: каждая запись имеет source, confidence, timestamps, evidence, status, provenance. */
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  evidence: string[];
  status: MemoryStatus;
  provenance: string;
}

export interface MemoryInput {
  type: MemoryType;
  content: string;
  source: string;
  confidence: number;
  evidence?: string[];
  provenance?: string;
}

export interface MemoryQuery {
  text?: string;
  type?: MemoryType;
  status?: MemoryStatus;
}

export interface MemoryCriteria {
  id?: string;
  type?: MemoryType;
  status?: MemoryStatus;
}

/** §10: единый интерфейс движка памяти. */
export interface MemoryEngine {
  remember(input: MemoryInput): Promise<MemoryRecord>;
  recall(query: MemoryQuery): Promise<MemoryRecord[]>;
  forget(criteria: MemoryCriteria): Promise<void>;
  reinforce(id: string): Promise<void>;
  contradict(id: string): Promise<void>;
}
