/**
 * L4 — гейт предложений скиллов: pending proposal только после evidence-порога.
 *
 * Никогда: auto-write production SKILL.md. Никогда: protected skills.
 * Один комментарий пользователя ≠ новый skill — нужен threshold + pending.
 *
 * Детерминированный гейт (без LLM): решение «создавать ли pending proposal»
 * принимается по evidenceCount + confidence + protected-проверке. Само
 * создание делегируется инъектируемому `createPendingProposal`.
 */
import type { SkillCandidateStore } from "./apply-lesson-route.js";

export const LEARNING_THRESHOLDS = {
  minEvidenceForSkillProposal: 3,
  minConfidenceForProposal: 0.6,
} as const;

export type SkillProposalRisk = "low" | "medium";

export interface PendingProposalDraft {
  summary: string;
  reason: string;
  affectedSkillId?: string;
  risk: SkillProposalRisk;
  status: "pending";
  content: string;
}

export interface SkillProposalGateDeps {
  /** Создаёт pending proposal (реальная имплементация сохраняет в SkillProposalStore). */
  createPendingProposal(draft: PendingProposalDraft): { id: string } | null;
  /** Проверка protected-skill (инъекция — реально isProtectedSkillContent). */
  isProtectedSkill?(skillId?: string): boolean;
}

export type SkillProposalGateResult =
  | {
      created: true;
      proposalId: string;
      reason: string;
      affectedSkillId?: string;
      risk: SkillProposalRisk;
    }
  | {
      created: false;
      reason: "insufficient_evidence" | "low_confidence" | "protected_skill" | "no_content";
    };

export function maybeCreateSkillProposal(
  args: { lessonContent: string; skillId?: string; evidenceCount: number; confidence: number },
  deps: SkillProposalGateDeps,
): SkillProposalGateResult {
  if (!args.lessonContent || !args.lessonContent.trim()) {
    return { created: false, reason: "no_content" };
  }
  if (args.evidenceCount < LEARNING_THRESHOLDS.minEvidenceForSkillProposal) {
    return { created: false, reason: "insufficient_evidence" };
  }
  if (args.confidence < LEARNING_THRESHOLDS.minConfidenceForProposal) {
    return { created: false, reason: "low_confidence" };
  }
  if (deps.isProtectedSkill?.(args.skillId)) {
    return { created: false, reason: "protected_skill" };
  }
  const risk: SkillProposalRisk = args.confidence >= 0.8 ? "low" : "medium";
  const created = deps.createPendingProposal({
    summary: args.lessonContent.slice(0, 200),
    reason: `evidence_count=${args.evidenceCount}; confidence=${args.confidence.toFixed(2)}`,
    affectedSkillId: args.skillId,
    risk,
    status: "pending",
    content: args.lessonContent,
  });
  if (!created) {
    return { created: false, reason: "no_content" };
  }
  return {
    created: true,
    proposalId: created.id,
    reason: "pending proposal created",
    affectedSkillId: args.skillId,
    risk,
  };
}

let proposedEvidenceCount = 0;

/**
 * Проверяет накопленные procedural-candidates и (при пороге) создаёт pending
 * proposal. Идемпотентно: уже обработанный объём evidence повторно не триггерит
 * proposal (чтобы не спамить по одному proposal каждый turn).
 */
export function maybeProposeFromCandidates(
  store: SkillCandidateStore,
  deps: SkillProposalGateDeps,
): SkillProposalGateResult {
  const evidence = store.list();
  const evidenceCount = evidence.length;
  if (evidenceCount <= proposedEvidenceCount) {
    return { created: false, reason: "insufficient_evidence" };
  }
  const confidence = Math.min(0.95, 0.5 + evidenceCount * 0.1);
  const lessonContent = evidence.map((e) => e.content).join("\n");
  const result = maybeCreateSkillProposal({ lessonContent, evidenceCount, confidence }, deps);
  if (result.created) {
    proposedEvidenceCount = evidenceCount;
  }
  return result;
}
