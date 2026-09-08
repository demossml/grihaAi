/**
 * Shared provider/model bootstrap.
 *
 * Applies a saved `GrishAiConfig` to a live pi session by registering the
 * provider (with its API key) and switching the active model. Used by the
 * first-run-setup extension (main session) and by the Telegram session pool
 * (isolated per-user sub-sessions), which is why it lives outside the
 * extensions directory.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { GrishAiConfig } from "@griha/shared-types";

export const CUSTOM_BASE_URL_DEFAULT = "https://api.openai.com/v1";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function makeModel(
  id: string,
  name?: string,
  opts?: { vision?: boolean },
): ProviderModelConfig {
  return {
    id,
    name: name ?? id,
    reasoning: false,
    input: opts?.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}

export function registerCustomProvider(pi: ExtensionAPI, cfg: GrishAiConfig): void {
  pi.registerProvider("custom", {
    name: "Custom endpoint",
    baseUrl: cfg.baseUrl ?? CUSTOM_BASE_URL_DEFAULT,
    apiKey: cfg.apiKey ?? "$CUSTOM_API_KEY",
    api: "openai-completions",
    models: [makeModel(cfg.model)],
  });
}

export function registerDeepSeekProvider(pi: ExtensionAPI, cfg: GrishAiConfig): void {
  pi.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: cfg.apiKey ?? "$DEEPSEEK_API_KEY",
    api: "openai-completions",
    models: [
      makeModel("deepseek-v4-pro", "DeepSeek V4 Pro"),
      makeModel("deepseek-v4-flash", "DeepSeek V4 Flash"),
      makeModel("deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision (Exp)", { vision: true }),
    ],
  });
}

/**
 * Apply a saved config to the live session: expose the API key, register
 * non-built-in providers, and switch the active model.
 */
export async function applyConfig(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  cfg: GrishAiConfig,
): Promise<boolean> {
  // Expose the key to pi via a provider override. A literal `apiKey` makes pi
  // consider auth "configured" for this provider; a runtime `process.env`
  // assignment alone is not re-read by pi after startup.
  if (cfg.provider === "custom") {
    registerCustomProvider(pi, cfg);
  } else if (cfg.apiKey) {
    pi.registerProvider(cfg.provider, { apiKey: cfg.apiKey });
  }

  let model = ctx.modelRegistry.find(cfg.provider, cfg.model);

  // Fallback: if DeepSeek is not in the built-in catalog, register it against
  // the official endpoint so setup still works end-to-end.
  if (!model && cfg.provider === "deepseek") {
    registerDeepSeekProvider(pi, cfg);
    model = ctx.modelRegistry.find("deepseek", cfg.model);
  }

  if (!model) {
    ctx.ui.notify(`Model "${cfg.provider}/${cfg.model}" not found`, "error");
    return false;
  }

  const ok = await pi.setModel(model);
  if (!ok) {
    ctx.ui.notify(
      `Could not activate ${cfg.provider}/${cfg.model} — is the API key set?`,
      "error",
    );
  }
  return ok;
}
