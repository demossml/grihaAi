/**
 * Phase 1 — профили бюджетов по сложности (детерминированные константы).
 */
import type { GenerationProfile, TaskComplexity, TaskKind } from "./types.js";

/** Версия таблиц профилей — пишется в GenerationBudget.policyVersion */
export const GENERATION_POLICY_VERSION = "gp-1.0.0";

/**
 * Абсолютный code-level ceiling. Config/env НЕ могут поднять hard выше этого.
 * (Модель может иметь свой maxTokens ниже — тогда режем по model.)
 */
export const CODE_HARD_CAP_OUTPUT_TOKENS = 8192;

export const PROFILES: Readonly<Record<TaskComplexity, GenerationProfile>> = {
  trivial: {
    temperature: 0.2,
    initialMaxTokens: 256,
    softMaxTokens: 512,
    hardMaxTokens: 1024,
    extensionStepTokens: 256,
    maxExtensions: 1,
  },
  simple: {
    temperature: 0.3,
    initialMaxTokens: 512,
    softMaxTokens: 1024,
    hardMaxTokens: 2048,
    extensionStepTokens: 512,
    maxExtensions: 2,
  },
  medium: {
    temperature: 0.5,
    initialMaxTokens: 1024,
    softMaxTokens: 2048,
    hardMaxTokens: 4096,
    extensionStepTokens: 512,
    maxExtensions: 2,
  },
  complex: {
    temperature: 0.6,
    initialMaxTokens: 2048,
    softMaxTokens: 4096,
    hardMaxTokens: 8192,
    extensionStepTokens: 1024,
    maxExtensions: 3,
  },
};

/**
 * Optional multipliers on initial/soft/hard by kind (1.0 = no change).
 * Phase 1: только мягкая корректировка initial (clamp после).
 */
export const KIND_INITIAL_COEFF: Readonly<Partial<Record<TaskKind, number>>> = {
  chat_reply: 1.0,
  tool_orchestration: 0.75,
  report_dispatch: 0.5,
  analysis: 1.25,
  vision_ocr: 0.75,
  compression: 0.5,
  other: 1.0,
};

/**
 * Phase 1 default-сложность (пока TaskProfile.complexity не приходит из router).
 * main → medium, vision → simple.
 */
export const DEFAULT_MAIN_COMPLEXITY: TaskComplexity = "medium";
export const DEFAULT_VISION_COMPLEXITY: TaskComplexity = "simple";
