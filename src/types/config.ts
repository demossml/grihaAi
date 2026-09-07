/**
 * Configuration types for the first-run setup wizard (Phase 0.5 / 1b).
 */

export type GrishAiProvider =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "google"
  | "xai"
  | "deepseek"
  | "custom";

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface GrishAiConfig {
  version: 1;
  provider: GrishAiProvider;
  model: string;
  /** Optional when the key is provided via environment (e.g. OPENAI_API_KEY). */
  apiKey?: string;
  /** Required for custom endpoints. */
  baseUrl?: string;
  /** ISO timestamp of when setup was completed. */
  setupCompletedAt: string;
  /** Optional Telegram bot configuration (Phase 8). */
  telegram?: TelegramConfig;
  /** Phase 10 — multi-model routing. Optional for backward compatibility. */
  models?: {
    main?: ModelConfig;
    vision?: ModelConfig;
  };
}

export interface TelegramConfig {
  botToken: string;
  /** Whitelist of allowed Telegram user ids. */
  allowedUserIds?: number[];
}
