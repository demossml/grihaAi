/**
 * Phase 5 (Item 5.2, матрица E5) — пайплайн:
 * candidate → confidence → conflict → persist.
 *
 * Чистые функции; применяются в `InMemoryMemoryStore` и (позже, за флагом)
 * при записи в существующий SQLite.
 */
import type { MemoryInput, MemoryRecord } from "./types.js";

export type PersistAction = "persist" | "reinforce" | "contradict" | "reject";

export interface PipelineDecision {
  action: PersistAction;
  reason: string;
  conflictingId?: string;
}

export interface PipelinePolicy {
  /** Минимальная confidence для статуса "confirmed". */
  confirmThreshold: number;
  /** Ниже — кандидат отклоняется. */
  rejectThreshold: number;
  /** Нормализованное сходство, при котором считается дубликатом. */
  duplicateSimilarity: number;
  /** Нормализованное сходство, при котором считается противоречием. */
  contradictionSimilarity: number;
}

export const DEFAULT_PIPELINE_POLICY: PipelinePolicy = {
  confirmThreshold: 0.7,
  rejectThreshold: 0.3,
  duplicateSimilarity: 0.9,
  contradictionSimilarity: 0.6,
};

/** Нормализация: lowercase + схлопывание пробелов. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Простое лексическое сходство (Dice по символьным биграммам), 0..1. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  return (2 * common) / (ba.size + bb.size);
}

/** Шаг 1: кандидат проходит по confidence. */
export function evaluateCandidate(
  input: MemoryInput,
  policy: PipelinePolicy = DEFAULT_PIPELINE_POLICY,
): { accepted: boolean; status: "candidate" | "confirmed" | "rejected"; reason: string } {
  if (input.confidence < policy.rejectThreshold) {
    return { accepted: false, status: "rejected", reason: `confidence ${input.confidence} < ${policy.rejectThreshold}` };
  }
  if (input.confidence >= policy.confirmThreshold) {
    return { accepted: true, status: "confirmed", reason: `confidence ${input.confidence} >= ${policy.confirmThreshold}` };
  }
  return { accepted: true, status: "candidate", reason: "confidence в диапазоне candidate" };
}

/** Шаг 2: конфликт с существующими записями (дубликат/противоречие/нет). */
export function detectConflict(
  input: MemoryInput,
  existing: readonly MemoryRecord[],
  policy: PipelinePolicy = DEFAULT_PIPELINE_POLICY,
): { kind: "none" | "duplicate" | "contradiction"; against?: MemoryRecord } {
  let best: MemoryRecord | undefined;
  let bestScore = 0;
  for (const record of existing) {
    if (record.type !== input.type) continue;
    const score = similarity(input.content, record.content);
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }
  if (!best || bestScore < policy.contradictionSimilarity) return { kind: "none" };
  // В среднем диапазоне: противоречие, если знак отрицания меняет смысл.
  // Проверка ДО duplicate: "не" добавляет пару символов, similarity остаётся высокой.
  // JS \b не работает с кириллицей (\w = ASCII), поэтому явные границы.
  const hasNegation = (t: string) =>
    /(^|[\s.,!?;:()-])(не|no|not|никогда|never|запрещ)(?=$|[\s.,!?;:()-])/i.test(t);
  if (hasNegation(input.content) !== hasNegation(best.content)) {
    return { kind: "contradiction", against: best };
  }
  if (bestScore >= policy.duplicateSimilarity) return { kind: "duplicate", against: best };
  return { kind: "none", against: best };
}

/** Шаг 3: итоговое решение по пайплайну. */
export function decidePersist(
  input: MemoryInput,
  existing: readonly MemoryRecord[],
  policy: PipelinePolicy = DEFAULT_PIPELINE_POLICY,
): PipelineDecision {
  const evalResult = evaluateCandidate(input, policy);
  if (!evalResult.accepted) return { action: "reject", reason: evalResult.reason };
  const conflict = detectConflict(input, existing, policy);
  if (conflict.kind === "duplicate") {
    return {
      action: "reinforce",
      reason: "near-duplicate существующей записи",
      conflictingId: conflict.against?.id,
    };
  }
  if (conflict.kind === "contradiction") {
    return {
      action: "contradict",
      reason: "противоречит существующей записи",
      conflictingId: conflict.against?.id,
    };
  }
  return { action: "persist", reason: "новая запись без конфликтов" };
}
