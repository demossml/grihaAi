/**
 * Wiring W1 (матрица B2) — ModelRouter поверх runtime-слоя за флагом.
 *
 * Флаг `HERMES_AGENT_RUNTIME` off (дефолт): поведение 1:1 с прежним.
 * Флаг on: getConfig идёт через runtime `resolveModelConfig` (семантика
 * main/vision идентична), aux-роли падают на main; selectForTask — через
 * `selectModelRole`.
 */
import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";
import { isAgentRuntimeEnabled } from "../../runtime/index.js";
import {
  resolveModelConfig,
  selectModelRole,
  type ModelRuntimeRole,
  type TaskProfile,
} from "../../runtime/model/index.js";

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
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  getConfig(role: ModelRole): ModelConfig {
    if (isAgentRuntimeEnabled(this.env)) {
      return resolveModelConfig(this.config, role as ModelRuntimeRole);
    }
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

  /**
   * W1: детерминированный выбор роли по TaskProfile (B2).
   * Флаг off → null (старое поведение у вызывающего кода).
   */
  selectForTask(task: TaskProfile): ModelRole | null {
    if (!isAgentRuntimeEnabled(this.env)) return null;
    return selectModelRole(task) as ModelRole;
  }

  async call(
    role: ModelRole,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!this.caller) throw new Error("No model caller configured");
    return this.caller(this.getConfig(role), messages);
  }
}
