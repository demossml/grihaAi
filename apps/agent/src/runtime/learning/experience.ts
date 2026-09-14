/**
 * Phase 7 (Item 7.2, матрица G3/G4) — experience store.
 *
 * Griha: experience = task/context/tools/errors/result/eval/lesson.
 * In-memory реализация; SQLite (nullable) — на этапе wiring за флагом.
 * G4: contradiction check → deprecate старого опыта.
 */
import { normalizeText, similarity } from "../memory/pipeline.js";

export interface ExperienceRecord {
  id: string;
  task: string;
  contextRef?: string;
  tools: string[];
  errors: string[];
  result?: string;
  evaluation: { score: number } | null;
  lesson?: string;
  createdAt: string;
  deprecated: boolean;
}

export interface ExperienceInput {
  task: string;
  contextRef?: string;
  tools?: string[];
  errors?: string[];
  result?: string;
  lesson?: string;
}

export interface ExperienceQuery {
  task?: string;
  deprecated?: boolean;
}

let seq = 0;
const defaultId = () => `exp-${++seq}`;

export class ExperienceStore {
  private readonly records: ExperienceRecord[] = [];
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(options: { idFactory?: () => string; now?: () => string } = {}) {
    this.idFactory = options.idFactory ?? defaultId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  add(input: ExperienceInput, score?: number): ExperienceRecord {
    const record: ExperienceRecord = {
      id: this.idFactory(),
      task: input.task,
      contextRef: input.contextRef,
      tools: input.tools ?? [],
      errors: input.errors ?? [],
      result: input.result,
      evaluation: typeof score === "number" ? { score } : null,
      lesson: input.lesson,
      createdAt: this.now(),
      deprecated: false,
    };
    this.records.push(record);
    return { ...record };
  }

  list(query: ExperienceQuery = {}): ExperienceRecord[] {
    const task = query.task?.toLowerCase();
    return this.records.filter((r) => {
      if (typeof query.deprecated === "boolean" && r.deprecated !== query.deprecated) return false;
      if (task && !r.task.toLowerCase().includes(task)) return false;
      return true;
    });
  }

  get(id: string): ExperienceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** G4: новый опыт противоречит старому (похожие task + разные result) → deprecate старого. */
  contradictionCheck(
    input: ExperienceInput,
    similarityThreshold = 0.7,
  ): { contradicted: ExperienceRecord | null } {
    const normalized = normalizeText(input.task);
    let best: ExperienceRecord | null = null;
    let bestScore = 0;
    for (const record of this.records) {
      if (record.deprecated) continue;
      const score = similarity(normalized, normalizeText(record.task));
      if (score > bestScore) {
        bestScore = score;
        best = record;
      }
    }
    if (!best || bestScore < similarityThreshold) return { contradicted: null };
    if (input.result && best.result && normalizeText(input.result) !== normalizeText(best.result)) {
      best.deprecated = true;
      return { contradicted: best };
    }
    return { contradicted: null };
  }
}
