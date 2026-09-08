import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";
import type { LearningLlm } from "./learning-extractor.js";
import { resolveModelBaseUrl } from "./provider-bootstrap.js";

export interface HttpLearningOptions {
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Resolve the model to use for learning extraction. Prefers `models.main` and
 * falls back to the legacy top-level provider/model — no model name is
 * hardcoded here; the configured one is used as-is.
 */
export function resolveLearningModel(cfg: GrishAiConfig): ModelConfig {
  return (
    cfg.models?.main ?? {
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
    }
  );
}

/**
 * Real `LearningLlm`: a small OpenAI-compatible `POST {baseUrl}/chat/completions`
 * call with the configured model (typically the cheap/fast main model). The key
 * comes from the model config, never from `process.env`.
 */
export function createHttpLearningLlm(
  cfg: GrishAiConfig,
  options: HttpLearningOptions = {},
): LearningLlm {
  const model = resolveLearningModel(cfg);
  const base = resolveModelBaseUrl(model);

  return async (prompt) => {
    if (!model.apiKey) {
      throw new Error(`Provider "${model.provider}" has no API key for learning extraction`);
    }

    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Learning LLM error ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  };
}
