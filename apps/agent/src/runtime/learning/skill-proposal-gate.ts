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
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "@griha/config";
import type { SkillCandidateEvidence, SkillCandidateStore } from "./apply-lesson-route.js";

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

/** Путь к JSON со счётчиками предложений per skill (best-effort persist). */
export function defaultProposedEvidencePath(): string {
  return path.join(getConfigDir(), "learning", "proposed-evidence.json");
}

/** Нормализация ключа: пустой skillId → "_default". */
function skillKey(skillId: string | undefined): string {
  return skillId && skillId.trim() ? skillId.trim() : "_default";
}

/** Читает JSON-объект → Map<skillKey, evidenceCount>. На ошибке — пустая Map. */
export function loadProposedMap(filePath?: string): Map<string, number> {
  const p = filePath ?? defaultProposedEvidencePath();
  const map = new Map<string, number>();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) map.set(k, v);
      }
    }
  } catch {
    // нет файла / битый JSON — пустая Map (не бросаем).
  }
  return map;
}

/** Пишет Map → JSON. try/catch: персистентность никогда не роняет caller. */
export function persistProposedMap(m: Map<string, number>, filePath?: string): void {
  try {
    const p = filePath ?? defaultProposedEvidencePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const obj: Record<string, number> = {};
    for (const [k, v] of m) obj[k] = v;
    fs.writeFileSync(p, JSON.stringify(obj), "utf8");
  } catch {
    // best-effort persist
  }
}

/** skillId → last evidenceCount, для которого уже создан proposal. */
const proposedEvidenceBySkill: Map<string, number> = loadProposedMap();

/** Для тестов: сбросить in-memory Map (файл не трогаем). */
export function resetProposedEvidenceForTests(): void {
  proposedEvidenceBySkill.clear();
}

/**
 * Проверяет накопленные procedural-candidates и (при пороге) создаёт pending
 * proposal. Дедуп — per skillId (Map, не глобальный скаляр): один скилл не
 * блокирует другой; счётчик переживает рестарт через JSON-persist.
 */
export function maybeProposeFromCandidates(
  store: SkillCandidateStore,
  deps: SkillProposalGateDeps,
): SkillProposalGateResult {
  const evidence = store.list();

  // Группируем evidence по skillId (плоский list → "_default" для всех без skillId).
  const bySkill = new Map<string, SkillCandidateEvidence[]>();
  for (const e of evidence) {
    const k = skillKey(e.skillId);
    const arr = bySkill.get(k) ?? [];
    arr.push(e);
    bySkill.set(k, arr);
  }

  // Не более одного proposal за вызов (первый skill с достаточным evidence).
  for (const [skillId, items] of bySkill) {
    const evidenceCount = items.length;
    const prev = proposedEvidenceBySkill.get(skillId) ?? 0;
    if (evidenceCount <= prev) continue; // уже обработанный объём — не дублируем
    if (evidenceCount < LEARNING_THRESHOLDS.minEvidenceForSkillProposal) continue;

    const confidence = Math.min(0.95, 0.5 + evidenceCount * 0.1);
    const lessonContent = items.map((e) => e.content).join("\n");
    const result = maybeCreateSkillProposal(
      {
        lessonContent,
        evidenceCount,
        confidence,
        skillId: skillId === "_default" ? undefined : skillId,
      },
      deps,
    );
    if (result.created) {
      proposedEvidenceBySkill.set(skillId, evidenceCount);
      persistProposedMap(proposedEvidenceBySkill);
      return result;
    }
  }
  return { created: false, reason: "insufficient_evidence" };
}
