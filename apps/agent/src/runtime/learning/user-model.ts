/**
 * Phase 7 (Item 7.3, матрица E8 + §11) — локальная user model
 * (аналог Honcho-диалектики без Honcho).
 *
 * §11: не превращать каждую фразу пользователя в permanent memory;
 * confidence + repeated evidence + contradiction detection +
 * expiration/deprecation + provenance.
 */

export type UserInsightCategory =
  | "preference"
  | "workflow"
  | "communication"
  | "goal"
  | "constraint"
  | "habit";

export type UserInsightStatus = "candidate" | "confirmed" | "deprecated";

export interface UserInsight {
  id: string;
  category: UserInsightCategory;
  statement: string;
  confidence: number;
  evidenceCount: number;
  status: UserInsightStatus;
  provenance: string;
}

export interface UserModelStoreOptions {
  confirmThreshold?: number;
  candidateThreshold?: number;
  now?: () => string;
  idFactory?: () => string;
}

let seq = 0;
const defaultId = () => `ui-${++seq}`;

export class UserModelStore {
  private readonly insights: UserInsight[] = [];
  private readonly confirmThreshold: number;
  private readonly candidateThreshold: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(options: UserModelStoreOptions = {}) {
    this.confirmThreshold = options.confirmThreshold ?? 0.7;
    this.candidateThreshold = options.candidateThreshold ?? 0.3;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? defaultId;
  }

  /**
   * Наблюдение (evidence): новое → candidate; повторное → confidence растёт,
   * evidenceCount++. Ниже candidateThreshold — НЕ запоминаем (не каждая фраза
   * становится permanent memory).
   */
  observe(
    category: UserInsightCategory,
    statement: string,
    provenance: string,
    delta = 0.2,
  ): UserInsight | null {
    const existing = this.insights.find(
      (i) =>
        i.category === category &&
        i.statement.toLowerCase() === statement.toLowerCase() &&
        i.status !== "deprecated",
    );
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + delta);
      existing.evidenceCount += 1;
      if (existing.confidence >= this.confirmThreshold && existing.status === "candidate") {
        existing.status = "confirmed";
      }
      return { ...existing };
    }
    if (delta < this.candidateThreshold) return null;
    const insight: UserInsight = {
      id: this.idFactory(),
      category,
      statement,
      confidence: Math.min(1, delta),
      evidenceCount: 1,
      status: delta >= this.confirmThreshold ? "confirmed" : "candidate",
      provenance,
    };
    this.insights.push(insight);
    return { ...insight };
  }

  /** Противоречие: новая формулировка с отрицанием → старый инсайт deprecated. */
  contradict(category: UserInsightCategory, statement: string): UserInsight | null {
    const target = this.insights.find(
      (i) => i.category === category && i.status !== "deprecated" && i.statement !== statement,
    );
    if (!target) return null;
    target.status = "deprecated";
    return { ...target };
  }

  list(category?: UserInsightCategory): UserInsight[] {
    const filtered = category
      ? this.insights.filter((i) => i.category === category)
      : [...this.insights];
    return filtered.map((i) => ({ ...i }));
  }
}
