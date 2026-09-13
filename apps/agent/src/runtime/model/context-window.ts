/**
 * Phase 2 (Item 2.4, матрица B4) — разрешение размера контекстного окна.
 *
 * Цепочка: ModelConfig.contextWindow (явный override) → каталог model→окно →
 * дефолт провайдера → DEFAULT_CONTEXT_WINDOW.
 * Не подключено к prod: `provider-bootstrap.ts` пока хардкодит 128000
 * (wiring — следующая фаза за флагом).
 */
import type { ModelConfig } from "@griha/shared-types";

/** Известные модели → размер окна. Пополняется по каталогу провайдера. */
export const MODEL_CONTEXT_WINDOW_CATALOG: Readonly<Record<string, number>> = {
  "deepseek-v4-pro": 128000,
  "deepseek-v4-flash": 128000,
  "deepseek-v4-flash-vision-exp": 128000,
};

/** Дефолты провайдеров (совпадают с bootstrap-значениями). */
export const PROVIDER_DEFAULT_CONTEXT_WINDOW: Readonly<Record<string, number>> = {
  deepseek: 128000,
  custom: 128000,
};

export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Цепочка разрешения окна для ModelConfig.
 * Явное поле конфига всегда выигрывает; далее каталог, затем провайдер.
 */
export function resolveContextWindow(
  cfg: ModelConfig,
  catalog: Readonly<Record<string, number>> = MODEL_CONTEXT_WINDOW_CATALOG,
): number {
  if (typeof cfg.contextWindow === "number" && cfg.contextWindow > 0) {
    return cfg.contextWindow;
  }
  const fromCatalog = catalog[cfg.model];
  if (typeof fromCatalog === "number" && fromCatalog > 0) return fromCatalog;
  const fromProvider = PROVIDER_DEFAULT_CONTEXT_WINDOW[cfg.provider];
  return typeof fromProvider === "number" && fromProvider > 0
    ? fromProvider
    : DEFAULT_CONTEXT_WINDOW;
}
