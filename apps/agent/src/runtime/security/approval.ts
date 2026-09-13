/**
 * Phase 11 (Item 11.4, матрица E6) — approval gate для записи в память.
 *
 * Hermes: memory write_approval gate. Конфигурируемая политика; чистая
 * функция (реальный запрос одобрения — wiring за флагом).
 */
import type { MemoryInput } from "../memory/types.js";

export interface MemoryWriteApprovalPolicy {
  /** Типы памяти, записи которых требуют одобрения. */
  requireForTypes: string[];
  /** Ниже этой confidence — запись требует одобрения (слабый сигнал). */
  lowConfidenceThreshold: number;
}

export const DEFAULT_MEMORY_WRITE_APPROVAL_POLICY: MemoryWriteApprovalPolicy = {
  requireForTypes: ["goal", "constraint"],
  lowConfidenceThreshold: 0.3,
};

export interface MemoryWriteDecision {
  approvalRequired: boolean;
  reasons: string[];
}

/**
 * Gate: требуется ли одобрение для записи в память.
 * - тип в requireForTypes → требуется;
 * - confidence ниже порога → требуется;
 * - иначе → не требуется.
 */
export function memoryWriteNeedsApproval(
  input: MemoryInput,
  policy: MemoryWriteApprovalPolicy = DEFAULT_MEMORY_WRITE_APPROVAL_POLICY,
): MemoryWriteDecision {
  const reasons: string[] = [];
  if (policy.requireForTypes.includes(input.type)) {
    reasons.push(`тип ${input.type} в списке обязательного одобрения`);
  }
  if (input.confidence < policy.lowConfidenceThreshold) {
    reasons.push(`confidence ${input.confidence} < ${policy.lowConfidenceThreshold}`);
  }
  return { approvalRequired: reasons.length > 0, reasons };
}

/** Конфигурируемая фабрика политики (DI). */
export function makeMemoryWriteApprovalPolicy(
  overrides: Partial<MemoryWriteApprovalPolicy> = {},
): MemoryWriteApprovalPolicy {
  return { ...DEFAULT_MEMORY_WRITE_APPROVAL_POLICY, ...overrides };
}
