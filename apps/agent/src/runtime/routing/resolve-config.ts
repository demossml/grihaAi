import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";
import type { RoutingDecision, RoutedModelRole } from "./types.js";

/**
 * Маппинг Phase 2 роли на legacy-роль ModelRouter ("main" | "vision").
 * flash → main (отдельного getConfig("flash") нет).
 */
export function toLegacyModelRole(role: RoutedModelRole): "main" | "vision" {
  if (role === "vision") return "vision";
  return "main";
}

/**
 * Конфиг модели для RoutingDecision.
 * - vision → models.vision (throw если не сконфигурирован);
 * - flash → models.flash если есть, иначе main с deepseek-v4-flash (если provider deepseek);
 * - main → models.main → legacy top-level.
 */
export function resolveModelConfigForDecision(
  config: GrishAiConfig,
  decision: RoutingDecision,
): ModelConfig {
  const models = config.models as
    | (GrishAiConfig["models"] & { flash?: ModelConfig })
    | undefined;
  if (decision.role === "vision") {
    const vision = models?.vision;
    if (!vision) throw new Error("Vision model is not configured");
    return vision;
  }
  const legacyMain: ModelConfig = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };
  const main = config.models?.main ?? legacyMain;
  if (decision.role === "flash") {
    const flash = models?.flash;
    if (flash) return flash;
    if (main.provider === "deepseek" || config.provider === "deepseek") {
      return { ...main, model: "deepseek-v4-flash" };
    }
    return main;
  }
  return main;
}
