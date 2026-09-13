/**
 * Phase 12 (Item 12.3, матрица F8) — conditional activation скиллов.
 *
 * Hermes: skill активируется только если его requires/fallback toolsets
 * доступны. Чистая функция-гейт.
 */
import type { Toolset } from "./toolsets.js";

export interface SkillRequirement {
  /** Обязательные toolsets. */
  requires: Toolset[];
  /** Fallback: альтернатива, если requires недоступны. */
  fallback?: Toolset[];
}

export interface ActivationDecision {
  activatable: boolean;
  reason: string;
  /** Каким набором активироваться (requires или fallback). */
  via: "requires" | "fallback" | "none";
}

/** Гейт активации скилла по доступным toolsets. */
export function isSkillActivatable(
  requirement: SkillRequirement,
  available: ReadonlySet<Toolset> | readonly Toolset[],
): ActivationDecision {
  const availableSet =
    available instanceof Set ? available : new Set<Toolset>(available);
  if (requirement.requires.every((t) => availableSet.has(t))) {
    return { activatable: true, reason: "requires доступны", via: "requires" };
  }
  if (requirement.fallback && requirement.fallback.some((t) => availableSet.has(t))) {
    return {
      activatable: true,
      reason: "requires недоступны — активируем через fallback",
      via: "fallback",
    };
  }
  return { activatable: false, reason: "ни requires, ни fallback недоступны", via: "none" };
}

/** Скилл без требований активируется всегда. */
export function alwaysActivatable(): ActivationDecision {
  return { activatable: true, reason: "без требований", via: "requires" };
}
