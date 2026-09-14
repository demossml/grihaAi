/**
 * Phase 7 (Item 7.4, матрица F4) — quality score скиллов.
 *
 * Griha: successRate/usage/regression. Чистый трекер без I/O.
 */

export interface SkillOutcome {
  success: boolean;
  atMs: number;
}

export interface SkillQuality {
  skillId: string;
  attempts: number;
  successes: number;
  /** Взвешенный score: недавние исходы весят больше. */
  score: number;
  /** Регрессия: последние исходы заметно хуже предыдущих. */
  regression: boolean;
}

export interface QualityTrackerOptions {
  /** Вес редукции для экспоненциального сглаживания (0..1, больше = старее). */
  decay: number;
  /** Размер окна для детекта регрессии. */
  regressionWindow: number;
  /** Порог падения для регрессии. */
  regressionDrop: number;
}

export const DEFAULT_QUALITY_OPTIONS: QualityTrackerOptions = {
  decay: 0.8,
  regressionWindow: 4,
  regressionDrop: 0.3,
};

export class SkillQualityTracker {
  private readonly outcomes = new Map<string, SkillOutcome[]>();
  private readonly options: QualityTrackerOptions;

  constructor(options: Partial<QualityTrackerOptions> = {}) {
    this.options = { ...DEFAULT_QUALITY_OPTIONS, ...options };
  }

  recordOutcome(skillId: string, success: boolean, atMs: number): void {
    const list = this.outcomes.get(skillId) ?? [];
    list.push({ success, atMs });
    this.outcomes.set(skillId, list);
  }

  /** Взвешенный score: экспоненциальное сглаживание успехов. */
  score(skillId: string): number | null {
    const list = this.outcomes.get(skillId);
    if (!list || list.length === 0) return null;
    let weighted = 0;
    let weightSum = 0;
    const decay = this.options.decay;
    for (let i = 0; i < list.length; i++) {
      const weight = Math.pow(decay, list.length - 1 - i);
      weighted += (list[i].success ? 1 : 0) * weight;
      weightSum += weight;
    }
    return weighted / weightSum;
  }

  /** Регрессия: среднее последних window исходов ниже предыдущего периода на drop. */
  regression(skillId: string): boolean {
    const list = this.outcomes.get(skillId) ?? [];
    const w = this.options.regressionWindow;
    if (list.length < w * 2) return false;
    const recent = list.slice(-w);
    const before = list.slice(-w * 2, -w);
    const avg = (xs: SkillOutcome[]) =>
      xs.reduce((s, o) => s + (o.success ? 1 : 0), 0) / xs.length;
    return avg(recent) + this.options.regressionDrop < avg(before);
  }

  /** Полный срез качества скилла. */
  quality(skillId: string): SkillQuality | null {
    const list = this.outcomes.get(skillId);
    if (!list || list.length === 0) return null;
    return {
      skillId,
      attempts: list.length,
      successes: list.filter((o) => o.success).length,
      score: this.score(skillId)!,
      regression: this.regression(skillId),
    };
  }
}
