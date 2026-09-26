/**
 * L4 — гейт предложений скиллов (evidence threshold, protected, pending only).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LEARNING_THRESHOLDS,
  loadProposedMap,
  maybeCreateSkillProposal,
  maybeProposeFromCandidates,
  persistProposedMap,
  resetProposedEvidenceForTests,
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

// Изоляция: per-skill Map — синглтон, а persist пишет в ~/.grish-ai. Тесты
// сбрасывают Map и перенаправляют persist в temp-директорию.
const savedHome = process.env.GRISH_AI_HOME;
const tmpDirs: string[] = [];

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-gate-"));
  tmpDirs.push(dir);
  process.env.GRISH_AI_HOME = dir;
  resetProposedEvidenceForTests();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.GRISH_AI_HOME;
  else process.env.GRISH_AI_HOME = savedHome;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

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

  it("per-skill дедуп: skill B не блокируется счётчиком skill A", () => {
    const drafts: PendingProposalDraft[] = [];
    const deps = makeDeps((d) => drafts.push(d));

    // skill A: 3 evidence → proposal.
    const storeA = new SkillCandidateStore(() => "t");
    storeA.add("a1", "review", "skill-a");
    storeA.add("a2", "review", "skill-a");
    storeA.add("a3", "review", "skill-a");
    const ra = maybeProposeFromCandidates(storeA, deps);
    assert.equal(ra.created, true);
    assert.equal((ra as { affectedSkillId?: string }).affectedSkillId, "skill-a");
    assert.equal(drafts.length, 1);

    // skill B: 3 evidence — НЕ заблокирован (старый скаляр дал бы 3 <= 3 → skip).
    const storeB = new SkillCandidateStore(() => "t");
    storeB.add("b1", "review", "skill-b");
    storeB.add("b2", "review", "skill-b");
    storeB.add("b3", "review", "skill-b");
    const rb = maybeProposeFromCandidates(storeB, deps);
    assert.equal(rb.created, true);
    assert.equal((rb as { affectedSkillId?: string }).affectedSkillId, "skill-b");
    assert.equal(drafts.length, 2);

    // skill A повторно с тем же объёмом → dedup (created:false).
    const ra2 = maybeProposeFromCandidates(storeA, deps);
    assert.equal(ra2.created, false);
    assert.equal(drafts.length, 2);
  });

  it("persist/load: Map переживает «рестарт»", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-persist-"));
    const p = path.join(dir, "proposed-evidence.json");
    const m = new Map<string, number>([
      ["skill-a", 3],
      ["skill-b", 5],
    ]);
    persistProposedMap(m, p);
    const loaded = loadProposedMap(p);
    assert.equal(loaded.get("skill-a"), 3);
    assert.equal(loaded.get("skill-b"), 5);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loadProposedMap: нет файла / битый JSON → пустая Map", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-bad-"));
    assert.equal(loadProposedMap(path.join(dir, "nope.json")).size, 0);
    const p = path.join(dir, "bad.json");
    fs.writeFileSync(p, "{ not json");
    assert.equal(loadProposedMap(p).size, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
