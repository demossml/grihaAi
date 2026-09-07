/**
 * Curated model catalog per provider (Phase 1c).
 *
 * `id` is the exact model identifier sent to the LLM API; `name` is what the
 * user sees in menus. `custom` is intentionally empty — the user types
 * everything by hand.
 */

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  openai: [
    { id: "gpt-4.1", name: "GPT-4.1", description: "Latest flagship" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "Fast & cheap" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "o3", name: "o3", description: "Reasoning" },
    { id: "o4-mini", name: "o4-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "openai/gpt-4.1", name: "GPT-4.1 (via OpenRouter)" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "x-ai/grok-3", name: "Grok 3" },
  ],
  google: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
  xai: [
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-3-mini", name: "Grok 3 Mini" },
    { id: "grok-2", name: "Grok 2" },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)", description: "Vision" },
  ],
  custom: [],
};

export function getModelsForProvider(provider: string): ModelOption[] {
  return PROVIDER_MODELS[provider] || [];
}
