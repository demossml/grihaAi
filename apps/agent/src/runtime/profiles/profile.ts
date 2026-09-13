/**
 * Phase 15 (Item 15.1, матрица O1 + §29) — профили ботов.
 *
 * §29: именованные боты (accountant/developer/secretary/researcher/travel),
 * но все используют единый Agent Runtime. Чистые контракты; wiring — за флагом.
 */
import type { ModelRuntimeRole } from "../model/types.js";
import type { Toolset } from "../toolsets/toolsets.js";

export interface MemoryPolicyRef {
  /** Какие типы памяти доступны профилю (пусто = все). */
  allowedMemoryTypes?: string[];
}

export interface AutomationPolicyRef {
  /** Разрешённые automation-виды для профиля. */
  allowedKinds?: ("one-shot" | "recurring" | "cron")[];
}

export interface AgentProfile {
  id: string;
  name: string;
  /** Персона: описание роли и стиля. */
  persona: string;
  /** Роль модели (§14-model roles из Phase 2). */
  modelRole: ModelRuntimeRole;
  /** Доступные toolsets (§23). */
  toolsets: Toolset[];
  memoryPolicy?: MemoryPolicyRef;
  automationPolicy?: AutomationPolicyRef;
}

/** §29: примеры именованных ботов. */
export const DEFAULT_PROFILES: readonly AgentProfile[] = [
  {
    id: "accountant",
    name: "Accountant",
    persona: "Бухгалтер: счета, расходы, отчётность. Формальный и точный.",
    modelRole: "main",
    toolsets: ["core", "memory", "finance"],
    memoryPolicy: { allowedMemoryTypes: ["fact", "preference", "constraint"] },
  },
  {
    id: "developer",
    name: "Developer",
    persona: "Разработчик: код, ревью, инструменты. Лаконичный.",
    modelRole: "main",
    toolsets: ["core", "memory", "coding"],
  },
  {
    id: "secretary",
    name: "Secretary",
    persona: "Секретарь: встречи, письма, планирование.",
    modelRole: "main",
    toolsets: ["core", "memory", "cron", "telegram"],
    automationPolicy: { allowedKinds: ["one-shot", "recurring"] },
  },
  {
    id: "researcher",
    name: "Researcher",
    persona: "Исследователь: поиск и анализ. Цитирует источники.",
    modelRole: "main",
    toolsets: ["core", "memory", "web"],
  },
  {
    id: "travel",
    name: "Travel",
    persona: "Travel-ассистент: маршруты, брони, билеты.",
    modelRole: "main",
    toolsets: ["core", "memory", "travel"],
  },
];

export class ProfileRegistry {
  private readonly profiles = new Map<string, AgentProfile>();

  register(profile: AgentProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`profile already registered: ${profile.id}`);
    }
    this.profiles.set(profile.id, { ...profile });
  }

  get(id: string): AgentProfile | undefined {
    const profile = this.profiles.get(id);
    return profile ? { ...profile } : undefined;
  }

  list(): AgentProfile[] {
    return [...this.profiles.values()].map((p) => ({ ...p }));
  }

  remove(id: string): boolean {
    return this.profiles.delete(id);
  }

  /** Единый Agent Runtime: выбор профиля по имени бота. */
  resolveByName(name: string): AgentProfile | undefined {
    const found = [...this.profiles.values()].find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    return found ? { ...found } : undefined;
  }
}

/** Registry с дефолтными профилями §29. */
export function createDefaultProfileRegistry(): ProfileRegistry {
  const registry = new ProfileRegistry();
  for (const profile of DEFAULT_PROFILES) registry.register(profile);
  return registry;
}
