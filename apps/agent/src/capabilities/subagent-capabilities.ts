import type { CapabilityId } from "../utils/capabilities.js";

/**
 * Sub-agent capability allowlist.
 *
 * Sub-agents run LLM-driven tool calls on untrusted input and are marked
 * `untrusted` (gateway blocks shell/file mutation). They also get a restricted
 * extension set, so most tools simply don't exist. This module is the explicit,
 * testable statement of what a sub-agent MAY use.
 */

export const SUBAGENT_CAPABILITIES: CapabilityId[] = [
  "memory.search",
  "ocr.process",
  "report.pdf",
  "report.pptx",
];

/** Capabilities a sub-agent must NEVER use. */
const FORBIDDEN: CapabilityId[] = [
  "memory.write",
  "cron.create",
  "cron.list",
  "cron.delete",
  "telegram.send",
  "finance.pay",
  "multi_agent.delegate",
  "email.send",
  "calendar.write",
  "travel.book",
  "crm.write",
  "accounting.write",
];

export function subagentAllowed(cap: CapabilityId): boolean {
  return SUBAGENT_CAPABILITIES.includes(cap);
}

export function subagentForbidden(cap: CapabilityId): boolean {
  return FORBIDDEN.includes(cap);
}

/** True when a sub-agent must not execute the capability. */
export function isSubagentCapabilityAllowed(cap: CapabilityId): boolean {
  return !subagentForbidden(cap);
}
