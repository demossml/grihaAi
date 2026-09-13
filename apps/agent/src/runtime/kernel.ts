/**
 * Phase 1 — AgentKernel: registry движков + детерминированный lifecycle.
 *
 * Инварианты:
 * - дубликат имени движка → ошибка регистрации;
 * - init — в порядке регистрации (каждого движка — ровно один раз);
 * - dispose — в обратном порядке;
 * - `enabled: false` → движки НЕ инициализируются (существующее поведение).
 */
import {
  type AgentKernel,
  type EngineName,
  type RuntimeEngine,
} from "./types.js";

export interface KernelInitOptions {
  enabled: boolean;
}

export class AgentKernelImpl implements AgentKernel {
  private readonly engines = new Map<EngineName, RuntimeEngine>();
  private readonly initOrder: EngineName[] = [];
  private initialized = false;

  register(engine: RuntimeEngine): void {
    if (this.engines.has(engine.name)) {
      throw new Error(`runtime engine already registered: ${engine.name}`);
    }
    if (this.initialized) {
      throw new Error("kernel already initialized — register engines before init()");
    }
    this.engines.set(engine.name, engine);
    this.initOrder.push(engine.name);
  }

  get<T extends RuntimeEngine>(name: EngineName): T | undefined {
    return this.engines.get(name) as T | undefined;
  }

  has(name: EngineName): boolean {
    return this.engines.has(name);
  }

  names(): EngineName[] {
    return [...this.initOrder];
  }

  async init(options: KernelInitOptions = { enabled: true }): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!options.enabled) return; // flag off → интерфейсы не активны
    for (const name of this.initOrder) {
      const engine = this.engines.get(name);
      await engine?.init?.({ engineName: name, enabled: true });
    }
  }

  async dispose(): Promise<void> {
    for (const name of [...this.initOrder].reverse()) {
      const engine = this.engines.get(name);
      await engine?.dispose?.();
    }
  }
}
