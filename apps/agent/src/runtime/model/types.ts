/**
 * Phase 2 (Item 2.1, матрица B1) — Model Runtime типы.
 *
 * Расширяет роли моделей без хардкода в production-коде. Ничего из этого
 * НЕ подключено к prod-путям; wiring — в следующих фазах за флагом
 * `HERMES_AGENT_RUNTIME`.
 */

/**
 * Роли моделей. "main" и "vision" соответствуют текущим прод-ролям
 * (`src/utils/routing/model-router.ts`); остальные — auxiliary slots (B5),
 * подключаются по мере появления подсистем (Phase 3/8/11/12).
 */
export type ModelRuntimeRole =
  | "main"
  | "vision"
  | "title"
  | "compression"
  | "summarization"
  | "approval"
  | "delegation"
  | "embedding"
  | "learning";

export const MODEL_RUNTIME_ROLES: readonly ModelRuntimeRole[] = [
  "main",
  "vision",
  "title",
  "compression",
  "summarization",
  "approval",
  "delegation",
  "embedding",
  "learning",
];

/** B5: вспомогательные роли, конфигурируемые отдельными слотами `models.*`. */
export const AUX_MODEL_ROLES: readonly ModelRuntimeRole[] = [
  "title",
  "compression",
  "summarization",
  "approval",
  "delegation",
  "learning",
];

/** Профиль задачи для детерминированного выбора роли (Item 2.2). */
export interface TaskProfile {
  /** Семантический вид задачи (напр. "chat", "ocr", "digest"). */
  kind: string;
  /** Требуются входные изображения. */
  needsVision?: boolean;
  /** Требуются эмбеддинги (векторный поиск). */
  needsEmbedding?: boolean;
  /** Требуется reasoning-модель. */
  needsReasoning?: boolean;
  /** Явная роль, если задача её задаёт (приоритет). */
  preferredRole?: ModelRuntimeRole;
}

/**
 * Политика роли: дефолтные параметры вызова без хардкода в call-sites.
 * `fallback` задаёт поведение при сбое (B3): менять модель или нет.
 */
export interface ModelPolicy {
  readonly role: ModelRuntimeRole;
  /** Разрешить fallback на следующий кандидат в цепочке (B3). */
  readonly allowFallback: boolean;
  /** Максимум попыток в FallbackChain для этой роли. */
  readonly maxAttempts: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/** Дефолтные политики для всех ролей. Без хардкода в prod. */
export const DEFAULT_MODEL_POLICIES: Readonly<Record<ModelRuntimeRole, ModelPolicy>> = {
  main: { role: "main", allowFallback: true, maxAttempts: 3, temperature: 0.7 },
  vision: { role: "vision", allowFallback: false, maxAttempts: 1, temperature: 0.2 },
  title: { role: "title", allowFallback: true, maxAttempts: 2, temperature: 0.3 },
  compression: { role: "compression", allowFallback: true, maxAttempts: 2, temperature: 0.3 },
  summarization: { role: "summarization", allowFallback: true, maxAttempts: 2, temperature: 0.5 },
  approval: { role: "approval", allowFallback: false, maxAttempts: 1, temperature: 0.1 },
  delegation: { role: "delegation", allowFallback: true, maxAttempts: 2, temperature: 0.5 },
  embedding: { role: "embedding", allowFallback: false, maxAttempts: 1, temperature: 0 },
  learning: { role: "learning", allowFallback: true, maxAttempts: 2, temperature: 0.4 },
};

/** Политика для роли: дефолтная или пользовательский override. */
export function modelPolicyFor(
  role: ModelRuntimeRole,
  override?: Partial<ModelPolicy>,
): ModelPolicy {
  return { ...DEFAULT_MODEL_POLICIES[role], ...override, role };
}
