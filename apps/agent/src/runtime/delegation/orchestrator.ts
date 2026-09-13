/**
 * Phase 8 (Item 8.2, матрица H3 + §18/§19) — orchestrator-контракт.
 *
 * §18: parent получает только structured result, не внутренний context.
 * §19: planner не имеет права самостоятельно обходить security policy.
 * Чистые функции; сами LLM-вызовы planner/workers — за флагом.
 */

export interface DelegationStep {
  id: string;
  task: string;
  workerId?: string;
  toolsets: string[];
  /** Шаг требует обхода security policy (planner не может это задавать). */
  requiresSecurityBypass?: boolean;
}

export interface DelegationPlan {
  parentTask: string;
  steps: DelegationStep[];
  /** Синтез допустим только после выполнения ВСЕХ шагов. */
  requiresAllSteps: boolean;
}

export interface WorkerResult {
  stepId: string;
  workerId: string;
  /** Structured результат: только вывод, без внутреннего контекста worker'а. */
  summary: string;
  ok: boolean;
  error?: string;
}

export interface SynthesisResult {
  ok: boolean;
  missingStepIds: string[];
  rejectedStepIds: string[];
  parts: Array<{ stepId: string; summary: string }>;
  synthesis: string;
}

/**
 * §19: планировщик не может обходить security policy — шаги с флагом
 * bypass отклоняются до запуска.
 */
export function verifyPlanSecurity(plan: DelegationPlan): string[] {
  return plan.steps.filter((s) => s.requiresSecurityBypass).map((s) => s.id);
}

/**
 * Синтез: parent видит только structured summaries. Пропущенные шаги →
 * synthesis не выполняется (ok=false, список missing).
 */
export function synthesize(plan: DelegationPlan, results: WorkerResult[]): SynthesisResult {
  const byStep = new Map(results.map((r) => [r.stepId, r]));
  const missing: string[] = [];
  const parts: Array<{ stepId: string; summary: string }> = [];
  for (const step of plan.steps) {
    const result = byStep.get(step.id);
    if (!result) {
      missing.push(step.id);
      continue;
    }
    parts.push({ stepId: step.id, summary: result.ok ? result.summary : `FAILED: ${result.error ?? "unknown"}` });
  }
  const rejected = verifyPlanSecurity(plan);
  if (rejected.length > 0 || (plan.requiresAllSteps && missing.length > 0)) {
    return {
      ok: false,
      missingStepIds: missing,
      rejectedStepIds: rejected,
      parts,
      synthesis: "",
    };
  }
  const synthesis = parts.map((p) => `[${p.stepId}] ${p.summary}`).join("\n");
  return { ok: true, missingStepIds: [], rejectedStepIds: [], parts, synthesis };
}

/** Проверка параллельного плана: уникальность stepId. */
export function validatePlan(plan: DelegationPlan): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const step of plan.steps) {
    if (seen.has(step.id)) errors.push(`duplicate stepId: ${step.id}`);
    seen.add(step.id);
  }
  return errors;
}
