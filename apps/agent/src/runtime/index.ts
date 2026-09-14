/**
 * Phase 1 — Agent Runtime: публичный API + feature flag.
 *
 * Пока этот слой НЕ подключён к production-путям. Включается поэтапно в
 * следующих фазах через `GRIHA_AGENT_RUNTIME` (по умолчанию off).
 */
import type { AgentKernel, RuntimeEngine } from "./types.js";
import { AgentKernelImpl } from "./kernel.js";

export {
  ENGINE_NAMES,
  type AgentKernel,
  type AgentRuntimeOptions,
  type EngineName,
  type RuntimeEngine,
  type RuntimeEngineContext,
} from "./types.js";
export { AgentKernelImpl, type KernelInitOptions } from "./kernel.js";

/**
 * Feature flag (§19 instr.md). Значения "1"/"true" → on, иначе off.
 * По умолчанию ВЫКЛЮЧЕН: существующее поведение Griha не меняется.
 */
export function isAgentRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GRIHA_AGENT_RUNTIME;
  if (raw === undefined) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Создать ядро с зарегистрированными движками (DI, тестируемо). */
export function createAgentKernel(engines: RuntimeEngine[]): AgentKernel {
  const kernel = new AgentKernelImpl();
  for (const engine of engines) kernel.register(engine);
  return kernel;
}
