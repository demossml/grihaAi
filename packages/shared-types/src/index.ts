/**
 * @griha/shared-types — стабильные доменные типы, используемые ≥2 пакетами.
 * Всё, что нужно только агенту, живёт в apps/agent/src/types.
 */

// --- Конфигурация (~/.grish-ai/config.json) ---

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

export interface TelegramConfig {
  botToken: string;
  /** Whitelist of allowed Telegram user ids. */
  allowedUserIds?: number[];
}

/** Embedding provider for vector memory (used when the main provider has no embeddings endpoint). */
export interface EmbeddingConfig {
  /** Provider id, e.g. "openai". */
  provider: string;
  /** Embedding model id (verified against the provider's current catalog). */
  model: string;
  apiKey?: string;
  /** OpenAI-compatible base URL. Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
}

export interface GrishAiConfig {
  version: 1;
  provider: GrishAiProvider;
  model: string;
  /** Optional when the key is provided via environment. */
  apiKey?: string;
  /** Required for custom endpoints. */
  baseUrl?: string;
  /** API key for the admin/STT HTTP API (apps/api). Unset = protected endpoints deny. */
  adminApiKey?: string;
  setupCompletedAt: string;
  telegram?: TelegramConfig;
  /** Multi-model routing (main + vision). */
  models?: {
    main?: ModelConfig;
    vision?: ModelConfig;
  };
  /** Embeddings for vector memory. Falls back to hashing embeddings when absent. */
  embedding?: EmbeddingConfig;
}

// --- User Rules ---

export type RuleScope = "global" | "chat";
export type RuleKind = "hard" | "soft";

export interface UserRule {
  id: string;
  scope: RuleScope;
  chatId?: string | null;
  ownerUserId?: string | null;
  text: string;
  kind: RuleKind;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Voice transcription (STT) ---

export interface TranscribeResult {
  ok: boolean;
  text: string;
  error?: string;
  durationMs?: number;
  language?: string;
}

export interface SttOptions {
  /** Path to the local STT script (default: <cwd>/scripts/stt_local.py). */
  scriptPath?: string;
  language?: string;
  timeoutMs?: number;
}
