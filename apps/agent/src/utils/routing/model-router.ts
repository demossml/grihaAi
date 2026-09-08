import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";

export type ModelRole = "main" | "vision"; // | "voice" later

export interface ModelCaller {
  (config: ModelConfig, messages: Array<{ role: string; content: string }>): Promise<string>;
}

/**
 * Routes a role to its model config. `main` falls back to the legacy top-level
 * provider/model for old configs; `vision` throws if not configured.
 */
export class ModelRouter {
  constructor(
    private readonly config: GrishAiConfig,
    private readonly caller?: ModelCaller,
  ) {}

  getConfig(role: ModelRole): ModelConfig {
    if (role === "vision") {
      const vision = this.config.models?.vision;
      if (!vision) throw new Error("Vision model is not configured");
      return vision;
    }
    return (
      this.config.models?.main ?? {
        provider: this.config.provider,
        model: this.config.model,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      }
    );
  }

  async call(
    role: ModelRole,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!this.caller) throw new Error("No model caller configured");
    return this.caller(this.getConfig(role), messages);
  }
}
