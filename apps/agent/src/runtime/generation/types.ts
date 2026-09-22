/**
 * Phase 1 — GenerationPolicy: детерминированные бюджеты генерации (без LLM).
 */

/** Сложность задачи для выбора профиля бюджета. */
export type TaskComplexity = "trivial" | "simple" | "medium" | "complex";

/**
 * Вид задачи (для коэффициентов / future router).
 * Phase 1: используется для optional coefficient, не для LLM.
 */
export type TaskKind =
  | "chat_reply"
  | "tool_orchestration"
  | "report_dispatch"
  | "analysis"
  | "vision_ocr"
  | "compression"
  | "other";

export interface GenerationPolicyInput {
  complexity: TaskComplexity;
  kind?: TaskKind;
  /** Если известен потолок модели (из ModelConfig / makeModel). */
  modelMaxTokens?: number;
  /**
   * Optional override из конфиг-файла (сужает, не расширяет hard выше code cap).
   * Все поля optional.
   */
  configOverride?: Partial<GenerationProfile>;
}

export interface GenerationProfile {
  temperature: number;
  /** Стартовый лимит output tokens на первый pass. */
  initialMaxTokens: number;
  /** Мягкий потолок: evaluator может просить extend до soft. */
  softMaxTokens: number;
  /** Жёсткий потолок: никогда не превышать. */
  hardMaxTokens: number;
  /** Шаг расширения output tokens. */
  extensionStepTokens: number;
  /** Максимум успешных extension за один turn. */
  maxExtensions: number;
}

export interface GenerationBudget {
  complexity: TaskComplexity;
  kind: TaskKind;
  temperature: number;
  initialMaxTokens: number;
  softMaxTokens: number;
  hardMaxTokens: number;
  extensionStepTokens: number;
  maxExtensions: number;
  /** policy version string for telemetry later */
  policyVersion: string;
}

export interface ExtensionState {
  extensionsUsed: number;
  currentMaxTokens: number;
}

export type ExtensionDecision =
  | { ok: true; nextMaxTokens: number; extensionsUsed: number }
  | { ok: false; reason: "max_extensions" | "would_exceed_hard" | "already_at_hard" };
