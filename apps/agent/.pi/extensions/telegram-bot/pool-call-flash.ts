import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";

/** callFlash, совместимый с FlashRouterDeps.callFlash. */
export type CallFlashFn = (
  messages: Array<{ role: "system" | "user"; content: string }>,
) => Promise<string>;

export interface FlashCallDeps {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Извлечь flash-конфиг (apiKey/baseUrl/model) из GrishAiConfig.
 * Приоритет: models.flash → models.main → legacy top-level.
 */
export function flashDepsFromConfig(cfg: GrishAiConfig): FlashCallDeps {
  const models = cfg.models as
    | (GrishAiConfig["models"] & { flash?: ModelConfig })
    | undefined;
  const flash = models?.flash;
  const main = models?.main;
  const apiKey = flash?.apiKey ?? main?.apiKey ?? cfg.apiKey;
  const baseUrl = flash?.baseUrl ?? main?.baseUrl ?? cfg.baseUrl;
  const model =
    flash?.model ?? (cfg.provider === "deepseek" ? "deepseek-v4-flash" : undefined);
  return { apiKey, baseUrl, model };
}

/**
 * Создать callFlash для routeMessage.
 * Использует DeepSeek flash (deepseek-v4-flash) или config.models.flash.
 * Timeout default 8000ms. При ошибке/timeout — throw (routeWithFlash поймает → fallback).
 */
export function createCallFlash(deps: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): CallFlashFn {
  const model = deps.model ?? "deepseek-v4-flash";
  const baseUrl = (deps.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const timeoutMs = deps.timeoutMs ?? 8000;
  const fetchFn = deps.fetchFn ?? fetch;

  return async (messages) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.0,
          max_tokens: 256, // router output is small JSON only
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`flash_http_${res.status}:${t.slice(0, 120)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("flash_empty_content");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
}
