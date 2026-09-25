/**
 * L4 — гейт предложений скиллов (evidence threshold, protected, pending only).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEARNING_THRESHOLDS,
  maybeCreateSkillProposal,
  maybeProposeFromCandidates,
  type PendingProposalDraft,
  type SkillProposalGateDeps,
} from "../../src/runtime/learning/skill-proposal-gate.js";
import { SkillCandidateStore } from "../../src/runtime/learning/apply-lesson-route.js";

function makeDeps(
  onDraft?: (draft: PendingProposalDraft) => void,
  protectedIds: string[] = [],
): SkillProposalGateDeps {
  return {
    createPendingProposal: (draft) => {
      onDraft?.(draft);
      return { id: `p-${Math.random().toString(36).slice(2, 6)}` };
    },
    isProtectedSkill: (skillId) => (skillId ? protectedIds.includes(skillId) : false),
  };
}

describe("maybeCreateSkillProposal (L4)", () => {
  it("evidenceCount=1 → no proposal (insufficient_evidence)", () => {
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d));
    const r = maybeCreateSkillProposal(
      { lessonContent: "делай так", evidenceCount: 1, confidence: 0.7 },
      deps,
    );
    assert.equal(r.created, false);
    assert.equal((r as { reason: string }).reason, "insufficient_evidence");
    assert.equal(drafts.length, 0);
  });

  it("evidenceCount>=3 → pending proposal created", () => {
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d));
    const r = maybeCreateSkillProposal(
      { lessonContent: "делай так", evidenceCount: 3, confidence: 0.7 },
      deps,
    );
    assert.equal(r.created, true);
    assert.equal(typeof (r as { proposalId: string }).proposalId, "string");
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, "pending");
    assert.equal(drafts[0].reason, "evidence_count=3; confidence=0.70");
  });

  it("low confidence → low_confidence", () => {
    const r = maybeCreateSkillProposal(
      { lessonContent: "x", evidenceCount: 5, confidence: 0.3 },
      makeDeps(),
    );
    assert.equal(r.created, false);
    assert.equal((r as { reason: string }).reason, "low_confidence");
  });

  it("protected skill → rejected before create", () => {
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d), ["delegation-triage"]);
    const r = maybeCreateSkillProposal(
      { lessonContent: "x", skillId: "delegation-triage", evidenceCount: 5, confidence: 0.9 },
      deps,
    );
    assert.equal(r.created, false);
    assert.equal((r as { reason: string }).reason, "protected_skill");
    assert.equal(drafts.length, 0); // reject ДО createPendingProposal
  });

  it("proposal не меняет активный контент — только pending, без активации", () => {
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d));
    const r = maybeCreateSkillProposal(
      { lessonContent: "процедура", evidenceCount: 4, confidence: 0.75 },
      deps,
    );
    assert.equal(r.created, true);
    assert.equal(drafts[0].status, "pending");
    // explainability-поля присутствуют
    assert.equal(typeof drafts[0].summary, "string");
    assert.equal(typeof drafts[0].reason, "string");
    assert.equal(drafts[0].risk, "medium");
  });

  it("no content → no_content", () => {
    const r = maybeCreateSkillProposal(
      { lessonContent: "   ", evidenceCount: 5, confidence: 0.9 },
      makeDeps(),
    );
    assert.equal(r.created, false);
    assert.equal((r as { reason: string }).reason, "no_content");
  });

  it("thresholds-константа: minEvidence=3, minConfidence=0.6", () => {
    assert.equal(LEARNING_THRESHOLDS.minEvidenceForSkillProposal, 3);
    assert.equal(LEARNING_THRESHOLDS.minConfidenceForProposal, 0.6);
  });
});

describe("maybeProposeFromCandidates (L4)", () => {
  it("накопление evidence до порога → один pending proposal (идемпотентно)", () => {
    const store = new SkillCandidateStore(() => "t");
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d));

    store.add("e1", "review");
    store.add("e2", "review");
    const r1 = maybeProposeFromCandidates(store, deps); // 2 < 3
    assert.equal(r1.created, false);

    store.add("e3", "review"); // теперь 3
    const r2 = maybeProposeFromCandidates(store, deps);
    assert.equal(r2.created, true);
    assert.equal(drafts.length, 1);

    const r3 = maybeProposeFromCandidates(store, deps); // не дублируем
    assert.equal(r3.created, false);
    assert.equal(drafts.length, 1);
  });
});
