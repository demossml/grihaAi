/**
 * Phase 1 — Agent Runtime interfaces (Hermes parity).
 *
 * Только контракты. Ни один production-путь не переключается на этот слой,
 * пока `HERMES_AGENT_RUNTIME` не включён явно (§19 instr.md: feature flag).
 * Имена engines соответствуют матрице A (docs/GRIHA_PARITY_MATRIX.md).
 */

/** Имена движков ядра (порядок = порядок init). */
export const ENGINE_NAMES = [
  "model",
  "context",
  "memory",
  "skill",
  "learning",
  "delegation",
  "session",
  "tool",
  "security",
  "automation",
] as const;

export type EngineName = (typeof ENGINE_NAMES)[number];

/** Минимальный контекст, доступный движку при init (расширяется по фазам). */
export interface RuntimeEngineContext {
  /** Имя движка в ядре. */
  engineName: EngineName;
  /** Флаг runtime: false = существующее поведение (интерфейсы не активны). */
  enabled: boolean;
}

/** Базовый контракт движка. */
export interface RuntimeEngine {
  readonly name: EngineName;
  init?(ctx: RuntimeEngineContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

/** Контракт ядра: registry + детерминированный lifecycle. */
export interface AgentKernel {
  register(engine: RuntimeEngine): void;
  get<T extends RuntimeEngine>(name: EngineName): T | undefined;
  has(name: EngineName): boolean;
  names(): EngineName[];
  init(ctx?: { enabled: boolean }): Promise<void>;
  dispose(): Promise<void>;
}

export interface AgentRuntimeOptions {
  /** HERMES_AGENT_RUNTIME. По умолчанию выключен (production не меняется). */
  enabled?: boolean;
}
