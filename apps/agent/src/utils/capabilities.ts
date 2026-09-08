import type { ExternalCapability } from "../types/index.js";

/**
 * Capability Registry — the single source of truth for what the system can do.
 *
 * Four statuses:
 *  - AVAILABLE             — implemented and usable now;
 *  - UNAVAILABLE           — not implemented;
 *  - REQUIRES_CONNECTION   — needs a connector that is not connected;
 *  - REQUIRES_APPROVAL     — implemented, but the action needs explicit approval.
 *
 * Skills check capabilities instead of guessing. An unavailable capability must
 * never produce fake success.
 */

export type InternalCapability =
  | "memory.search"
  | "memory.write"
  | "cron.create"
  | "cron.list"
  | "cron.delete"
  | "telegram.send"
  | "stt.transcribe"
  | "ocr.process"
  | "report.pdf"
  | "report.pptx"
  | "multi_agent.delegate"
  | "finance.pay";

export type CapabilityId = InternalCapability | ExternalCapability;

export type CapabilityStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "REQUIRES_CONNECTION"
  | "REQUIRES_APPROVAL";

const CAPABILITIES: Record<CapabilityId, CapabilityStatus> = {
  // Internal — implemented.
  "memory.search": "AVAILABLE",
  "memory.write": "AVAILABLE",
  "cron.create": "AVAILABLE",
  "cron.list": "AVAILABLE",
  "cron.delete": "AVAILABLE",
  "telegram.send": "AVAILABLE",
  "stt.transcribe": "AVAILABLE",
  "ocr.process": "AVAILABLE",
  "report.pdf": "AVAILABLE",
  "report.pptx": "AVAILABLE",
  "multi_agent.delegate": "AVAILABLE",
  // Internal — implemented but approval-gated.
  "finance.pay": "REQUIRES_APPROVAL",
  // External — no connectors connected yet.
  "email.read": "REQUIRES_CONNECTION",
  "email.draft": "REQUIRES_CONNECTION",
  "email.send": "REQUIRES_CONNECTION",
  "calendar.read": "REQUIRES_CONNECTION",
  "calendar.write": "REQUIRES_CONNECTION",
  "travel.read": "REQUIRES_CONNECTION",
  "travel.book": "REQUIRES_CONNECTION",
  "crm.read": "REQUIRES_CONNECTION",
  "crm.write": "REQUIRES_CONNECTION",
  "accounting.read": "REQUIRES_CONNECTION",
  "accounting.write": "REQUIRES_CONNECTION",
};

const LIMITATIONS: Partial<Record<CapabilityId, string>> = {
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

export function getCapabilityStatus(cap: CapabilityId): CapabilityStatus {
  return CAPABILITIES[cap] ?? "UNAVAILABLE";
}

/** True only when the capability is fully usable without further conditions. */
export function capabilityAvailable(cap: CapabilityId): boolean {
  return getCapabilityStatus(cap) === "AVAILABLE";
}

export function describeLimitation(cap: CapabilityId): string {
  return LIMITATIONS[cap] ?? `Capability "${cap}" is ${getCapabilityStatus(cap)}.`;
}

export interface CapabilityReport {
  capabilities: Record<CapabilityId, CapabilityStatus>;
  degradedSkills: string[];
  approvalRequiredActions: string[];
}

/** Machine-readable capability report. */
export function capabilitiesReport(): CapabilityReport {
  const capabilities = { ...CAPABILITIES };

  const degradedSkills: string[] = [];
  if (getCapabilityStatus("email.send") !== "AVAILABLE") degradedSkills.push("correspondence", "inbox-triage");
  if (
    getCapabilityStatus("calendar.read") !== "AVAILABLE" ||
    getCapabilityStatus("calendar.write") !== "AVAILABLE"
  ) {
    degradedSkills.push("calendar-scheduling");
  }
  if (getCapabilityStatus("travel.book") !== "AVAILABLE") degradedSkills.push("travel-coordination");

  return {
    capabilities,
    degradedSkills,
    approvalRequiredActions: [
      "email.send",
      "calendar.write",
      "travel.book",
      "accounting.write",
      "finance.pay",
      "delete",
      "publish",
    ],
  };
}
