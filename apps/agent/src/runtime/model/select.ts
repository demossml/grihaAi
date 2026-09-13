/**
 * Phase 2 (Item 2.2, матрица B2) — детерминированный выбор роли и конфига.
 *
 * Чистые функции. Семантика main/vision повторяет текущий прод-`ModelRouter`
 * (`src/utils/routing/model-router.ts`); вспомогательные роли падают на main,
 * пока схема `models` не расширена (B5, Phase 3/8/11/12).
 */
import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";
import type { ModelRuntimeRole, TaskProfile } from "./types.js";

/** Порядок приоритетов: явная роль → vision → embedding → main. */
export function selectModelRole(task: TaskProfile): ModelRuntimeRole {
  if (task.preferredRole) return task.preferredRole;
  if (task.needsVision) return "vision";
  if (task.needsEmbedding) return "embedding";
  return "main";
}

/**
 * Конфиг модели для роли. Парность с прод-`ModelRouter.getConfig`:
 * - vision: `models.vision`, ошибка если не сконфигурирован;
 * - остальные: `models[role]` → `models.main` → legacy top-level
 *   (provider/model/apiKey/baseUrl).
 */
export function resolveModelConfig(
  cfg: GrishAiConfig,
  role: ModelRuntimeRole,
): ModelConfig {
  const models = cfg.models as Partial<Record<ModelRuntimeRole, ModelConfig>> | undefined;
  if (role === "vision") {
    const vision = models?.vision;
    if (!vision) throw new Error("Vision model is not configured");
    return vision;
  }
  return (
    models?.[role] ??
    models?.main ?? {
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
    }
  );
}
