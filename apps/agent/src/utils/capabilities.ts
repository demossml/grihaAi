import type { ExternalCapability } from "../types/index.js";

/**
 * Connector capability contract.
 *
 * Skills check a capability before claiming an external action. When a
 * capability is absent, the skill must fall back to a local workflow and tell
 * the user the limitation — never pretend the action succeeded.
 *
 * Today no external connectors are implemented: everything is local
 * (Telegram, internal calendar, SQLite). This module is the single place that
 * will become non-empty when connectors land.
 */

/** Capabilities currently provided by a real connector (none yet). */
const AVAILABLE = new Set<ExternalCapability>([]);

const LIMITATIONS: Record<ExternalCapability, string> = {
  "email.read": "Gmail/IMAP connector не подключён — чтение почты недоступно.",
  "email.draft": "Почтовый connector не подключён — можно только подготовить draft локально.",
  "email.send": "Почтовый connector не подключён — отправка невозможна (draft + approval).",
  "calendar.read": "Внешний календарь не подключён — доступен только внутренний календарь.",
  "calendar.write": "Внешний календарь не подключён — изменения только во внутреннем календаре.",
  "travel.read": "Travel connector не подключён — используются только данные пользователя.",
  "travel.book": "Travel booking не реализован — бронирование недоступно.",
  "crm.read": "CRM connector не подключён — используются локальные контакты/заметки.",
  "crm.write": "CRM connector не подключён — изменения только в локальном хранилище.",
  "accounting.read": "Accounting connector не подключён — используются только локальные данные.",
  "accounting.write": "Accounting connector не подключён — запись во внешнюю систему недоступна.",
};

export function capabilityAvailable(cap: ExternalCapability): boolean {
  return AVAILABLE.has(cap);
}

export function describeLimitation(cap: ExternalCapability): string {
  return LIMITATIONS[cap];
}

export interface CapabilityReport {
  capabilities: Record<ExternalCapability, boolean>;
  degradedSkills: string[];
  approvalRequiredActions: string[];
}

/**
 * Machine-readable capability report: which capabilities exist, which skills
 * are degraded by their absence, and which actions always need approval.
 */
export function capabilitiesReport(): CapabilityReport {
  const capabilities = {} as Record<ExternalCapability, boolean>;
  for (const cap of Object.keys(LIMITATIONS) as ExternalCapability[]) {
    capabilities[cap] = capabilityAvailable(cap);
  }

  const degradedSkills: string[] = [];
  if (!capabilityAvailable("email.send")) degradedSkills.push("correspondence", "inbox-triage");
  if (!capabilityAvailable("calendar.read") || !capabilityAvailable("calendar.write")) {
    degradedSkills.push("calendar-scheduling");
  }
  if (!capabilityAvailable("travel.book")) degradedSkills.push("travel-coordination");

  return {
    capabilities,
    degradedSkills,
    approvalRequiredActions: [
      "email.send",
      "calendar.write",
      "travel.book",
      "accounting.write",
      "invoice.pay",
      "delete",
      "publish",
    ],
  };
}
