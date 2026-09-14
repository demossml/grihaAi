/**
 * Wiring W1 (матрица B2) — ModelRouter поверх runtime-слоя за флагом.
 *
 * Флаг `GRIHA_AGENT_RUNTIME` off (дефолт): поведение 1:1 с прежним.
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
import { runtimeObservability } from "./runtime-observability.js";
import {
  classifyError,
  FallbackChain,
} from "../../runtime/model/fallback-chain.js";
import { modelPolicyFor } from "../../runtime/model/types.js";

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
    const config = this.getConfig(role);

    // B3 (post-wiring, §7): FallbackChain по политике роли.
    // Off = прямой вызов (1:1 старое поведение, без fallback).
    if (isAgentRuntimeEnabled(this.env)) {
      return this.callWithFallback(role, config, messages);
    }
    return this.callOnce(role, config, messages);
  }

  /** Одиночный вызов без fallback (off-путь и последний кандидат). */
  private async callOnce(
    role: ModelRole,
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!this.caller) throw new Error("No model caller configured");
    return this.caller(config, messages);
  }

  /** B3: вызов с цепочкой fallback (за флагом). */
  private async callWithFallback(
    role: ModelRole,
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!this.caller) throw new Error("No model caller configured");
    const pool = [
      config,
      ...(this.config.models?.fallbackModels ?? []),
    ];
    const chain = new FallbackChain(pool);
    const policy = modelPolicyFor(
      role === "vision" ? "vision" : "main",
    );
    const maxAttempts = policy.allowFallback
      ? Math.min(policy.maxAttempts, chain.size)
      : 1;

    const { correlationId } = runtimeObservability.begin(
      role,
      `${config.provider}/${config.model}`,
    );
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = chain.pick(attempt);
      if (!candidate) break;
      const startedAt = Date.now();
      try {
        const result = await this.caller(candidate, messages);
        runtimeObservability.end(correlationId, role, candidate.model, {
          inputTokens: runtimeObservability.estimateInputTokens(messages),
          outputTokens: result.length,
          toolCalls: 0,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        lastError = error;
        const category = classifyError(error);
        const next = chain.nextAfter(attempt, category);
        if (next === null) {
          runtimeObservability.fail(correlationId, error);
          throw error;
        }
        const nextModel = chain.pick(next);
        if (nextModel) {
          runtimeObservability.fallback(
            correlationId,
            `${candidate.provider}/${candidate.model}`,
            `${nextModel.provider}/${nextModel.model}`,
            error,
          );
        }
      }
    }
    runtimeObservability.fail(correlationId, lastError);
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
