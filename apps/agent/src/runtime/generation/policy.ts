/**
 * Phase 1 — resolveGenerationBudget: чистая функция (нет I/O, нет LLM).
 */
import {
  CODE_HARD_CAP_OUTPUT_TOKENS,
  GENERATION_POLICY_VERSION,
  KIND_INITIAL_COEFF,
  PROFILES,
} from "./profiles.js";
import type {
  GenerationBudget,
  GenerationPolicyInput,
  GenerationProfile,
  TaskKind,
} from "./types.js";

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Собрать профиль с учётом override (override может ТОЛЬКО сузить hard
 * и другие лимиты относительно base+code cap, не поднять hard выше cap).
 */
export function mergeProfile(
  base: GenerationProfile,
  override?: Partial<GenerationProfile>,
): GenerationProfile {
  const merged: GenerationProfile = { ...base, ...override };
  const hard = clampInt(merged.hardMaxTokens, 64, CODE_HARD_CAP_OUTPUT_TOKENS);
  const soft = clampInt(merged.softMaxTokens, 64, hard);
  const initial = clampInt(merged.initialMaxTokens, 32, soft);
  const step = clampInt(merged.extensionStepTokens, 32, hard);
  const maxExt = clampInt(merged.maxExtensions, 0, 8);
  const temperature = Math.max(0, Math.min(1.5, merged.temperature));
  return {
    temperature,
    initialMaxTokens: initial,
    softMaxTokens: soft,
    hardMaxTokens: hard,
    extensionStepTokens: step,
    maxExtensions: maxExt,
  };
}

/**
 * Главная функция Phase 1. Чистая: нет I/O, нет Date.now обязательного.
 */
export function resolveGenerationBudget(input: GenerationPolicyInput): GenerationBudget {
  const complexity = input.complexity;
  const kind: TaskKind = input.kind ?? "other";
  const base = PROFILES[complexity];
  if (!base) {
    return resolveGenerationBudget({ ...input, complexity: "simple" });
  }

  let profile = mergeProfile(base, input.configOverride);

  // kind coefficient на initial only
  const coeff = KIND_INITIAL_COEFF[kind] ?? 1.0;
  const adjustedInitial = clampInt(
    profile.initialMaxTokens * coeff,
    32,
    profile.softMaxTokens,
  );
  profile = { ...profile, initialMaxTokens: adjustedInitial };

  // report_dispatch — tool-calling reports need headroom; не даём trivial 128.
  if (kind === "report_dispatch") {
    const minInitial = 1024;
    const minSoft = 2048;
    const minHard = 4096;
    let hard = Math.max(profile.hardMaxTokens, minHard);
    hard = Math.min(hard, CODE_HARD_CAP_OUTPUT_TOKENS);
    let soft = Math.max(profile.softMaxTokens, minSoft);
    soft = Math.min(soft, hard);
    let initial = Math.max(profile.initialMaxTokens, minInitial);
    initial = Math.min(initial, soft);
    profile = {
      ...profile,
      initialMaxTokens: initial,
      softMaxTokens: soft,
      hardMaxTokens: hard,
    };
  }

  // model max tokens ceiling
  if (typeof input.modelMaxTokens === "number" && input.modelMaxTokens > 0) {
    const modelCap = Math.floor(input.modelMaxTokens);
    const hard = Math.min(profile.hardMaxTokens, modelCap, CODE_HARD_CAP_OUTPUT_TOKENS);
    const soft = Math.min(profile.softMaxTokens, hard);
    const initial = Math.min(profile.initialMaxTokens, soft);
    profile = {
      ...profile,
      hardMaxTokens: hard,
      softMaxTokens: soft,
      initialMaxTokens: initial,
    };
  }

  if (
    !(
      profile.initialMaxTokens <= profile.softMaxTokens &&
      profile.softMaxTokens <= profile.hardMaxTokens
    )
  ) {
    profile = mergeProfile(profile);
  }

  return {
    complexity,
    kind,
    temperature: profile.temperature,
    initialMaxTokens: profile.initialMaxTokens,
    softMaxTokens: profile.softMaxTokens,
    hardMaxTokens: profile.hardMaxTokens,
    extensionStepTokens: profile.extensionStepTokens,
    maxExtensions: profile.maxExtensions,
    policyVersion: GENERATION_POLICY_VERSION,
  };
}
