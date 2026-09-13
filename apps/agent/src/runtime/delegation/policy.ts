/**
 * Phase 8 (Item 8.3, матрица H5) — политика делегирования.
 *
 * Hermes: отдельная delegation-модель. Роль `"delegation"` уже входит в
 * `ModelRuntimeRole` (Phase 2, B1) и `resolveModelConfig` отдаст для неё
 * `models.delegation` → main. Здесь — дефолтная политика: роль, лимиты,
 * базовый toolset.
 */
import { DEFAULT_DELEGATION_LIMITS, type DelegationLimits } from "./limits.js";

export interface DelegationPolicy {
  /** Отдельная модель для делегирования (resolveModelConfig fallback на main). */
  modelRole: "delegation";
  limits: DelegationLimits;
  /** Базовый toolset worker'а (ограниченный по умолчанию). */
  defaultToolsets: string[];
}

export const DEFAULT_DELEGATION_POLICY: DelegationPolicy = {
  modelRole: "delegation",
  limits: DEFAULT_DELEGATION_LIMITS,
  defaultToolsets: ["memory", "skill"],
};

export function makeDelegationPolicy(
  overrides: Partial<DelegationPolicy> = {},
): DelegationPolicy {
  return { ...DEFAULT_DELEGATION_POLICY, ...overrides };
}
