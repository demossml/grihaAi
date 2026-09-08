import type { CapabilityId } from "../utils/capabilities.js";

/**
 * Workflow layer — light coordination of steps.
 *
 * A workflow coordinates steps; a skill represents a capability; a service
 * contains business logic; a provider talks to an external system. Workflows
 * do not execute anything themselves — they describe the deterministic order
 * the orchestrator follows, and which capability each step needs.
 */

export interface WorkflowStep {
  id: string;
  /** Skill that implements this step (canonical name). */
  skill: string;
  /** Capability the step requires. */
  capability?: CapabilityId;
  description: string;
}

export interface Workflow {
  name: string;
  steps: WorkflowStep[];
}

export const MEETING_WORKFLOW: Workflow = {
  name: "meeting",
  steps: [
    { id: "prepare", skill: "meeting-prep", capability: "memory.search", description: "Собрать контекст встречи" },
    { id: "meeting", skill: "meeting-notes", capability: "report.pdf", description: "Провести встречу и зафиксировать" },
    { id: "commit", skill: "commitment-tracking", capability: "memory.write", description: "Action items → обязательства" },
    { id: "followup", skill: "meeting-followup", capability: "email.draft", description: "Summary + draft follow-up" },
    { id: "track", skill: "daily-briefing", capability: "cron.create", description: "Периодический контроль дедлайнов" },
  ],
};

export const FINANCE_WORKFLOW: Workflow = {
  name: "finance",
  steps: [
    { id: "intake", skill: "document-intake-ocr", capability: "ocr.process", description: "Чек/счёт → структура" },
    { id: "track", skill: "expense-invoice-tracking", capability: "memory.write", description: "Расход/счёт сохранены" },
    { id: "categorize", skill: "transaction-categorization", capability: "memory.search", description: "Категоризация" },
    { id: "approve", skill: "approval-thresholds", capability: "finance.pay", description: "Пороги подтверждения" },
    { id: "followup", skill: "invoice-followup", capability: "cron.create", description: "Контроль due/overdue" },
    { id: "report", skill: "financial-report", capability: "report.pdf", description: "Финансовый отчёт" },
    { id: "anomaly", skill: "anomaly-watch", capability: "cron.list", description: "Детекция аномалий" },
  ],
};

const WORKFLOWS: Record<string, Workflow> = {
  [MEETING_WORKFLOW.name]: MEETING_WORKFLOW,
  [FINANCE_WORKFLOW.name]: FINANCE_WORKFLOW,
};

export function listWorkflows(): Workflow[] {
  return Object.values(WORKFLOWS);
}

export function getWorkflow(name: string): Workflow | undefined {
  return WORKFLOWS[name];
}

/** Deterministic next step after `currentStepId`, or undefined at the end. */
export function nextStep(workflow: Workflow, currentStepId: string): WorkflowStep | undefined {
  const idx = workflow.steps.findIndex((s) => s.id === currentStepId);
  if (idx < 0 || idx >= workflow.steps.length - 1) return undefined;
  return workflow.steps[idx + 1];
}

/** Capabilities a workflow needs, in step order (deduplicated). */
export function workflowCapabilities(workflow: Workflow): CapabilityId[] {
  const caps: CapabilityId[] = [];
  for (const step of workflow.steps) {
    if (step.capability && !caps.includes(step.capability)) caps.push(step.capability);
  }
  return caps;
}
