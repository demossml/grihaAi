/**
 * L5 — детерминированная оценка candidate-версии скилла перед активацией.
 *
 * НЕ LLM: решение по фактическим outcome (successRate) из SkillQualityTracker.
 * НИКОГДА: `pass: true` только потому, что LLM написала proposal.
 *
 * Minimal gate:
 * - нет данных → pass=false reason=insufficient_data (без слепой активации);
 * - successRate < 0.5 по окну → pass=false;
 * - иначе → pass=true.
 */
import { SkillQualityTracker } from "./quality.js";

export interface CandidateEvaluation {
  pass: boolean;
  reason: string;
  successRate?: number;
}

const BASELINE_SUCCESS_RATE = 0.5;

export function evaluateCandidate(
  skillId: string,
  tracker: SkillQualityTracker,
  window = 20,
): CandidateEvaluation {
  const rate = tracker.successRate(skillId, window);
  if (rate === null) {
    return { pass: false, reason: "insufficient_data" };
  }
  if (rate < BASELINE_SUCCESS_RATE) {
    return { pass: false, reason: `success_rate_below_threshold (${rate.toFixed(2)})`, successRate: rate };
  }
  return { pass: true, reason: "ok", successRate: rate };
}
