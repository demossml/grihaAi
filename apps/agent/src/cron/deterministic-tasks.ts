import type {
  Anomaly,
  ApprovalRequestRecord,
  CalendarEvent,
  ClientNote,
  Commitment,
  Expense,
  Invoice,
} from "../types/index.js";
import { buildBriefing } from "../utils/briefing.js";
import {
  detectCommitmentOverdue,
  detectDuplicateInvoices,
  detectExpenseOutliers,
} from "../utils/anomaly-detect.js";

/**
 * Deterministic cron tasks.
 *
 * Cron is an execution layer: it runs deterministic service queries first and
 * only synthesises with an LLM afterwards when necessary. These tasks never
 * ask the LLM to scan all of memory to decide what is overdue.
 */

export interface DeterministicTaskDeps {
  userId: string;
  timezone: string;
  now: Date;
  listCommitments(): Commitment[];
  listAnomalies(): Anomaly[];
  listApprovals(): ApprovalRequestRecord[];
  listEvents(): CalendarEvent[];
  listClientNotes(): Promise<ClientNote[]>;
  listExpenses(): Expense[];
  listInvoices(): Invoice[];
}

export type DeterministicTaskName = "daily-briefing" | "anomaly-scan" | "commitment-due-scan";

export interface DeterministicTaskResult {
  name: DeterministicTaskName;
  summary: string;
}

function dueLines(commitments: Commitment[], now: Date): string[] {
  const overdue = commitments.filter((c) => c.status === "overdue");
  const dueSoon = commitments.filter((c) => c.status === "due_soon");
  const lines: string[] = [];
  if (overdue.length > 0) {
    lines.push("Просрочено:");
    for (const c of overdue) lines.push(`- ${c.text}`);
  }
  if (dueSoon.length > 0) {
    lines.push("Скоро (due soon):");
    for (const c of dueSoon) lines.push(`- ${c.text}`);
  }
  void now;
  return lines;
}

export async function runDeterministicTask(
  name: DeterministicTaskName,
  deps: DeterministicTaskDeps,
): Promise<DeterministicTaskResult> {
  if (name === "daily-briefing") {
    const commitments = deps.listCommitments();
    const { text } = buildBriefing({
      events: deps.listEvents(),
      commitments,
      anomalies: deps.listAnomalies().filter((a) => a.status === "new"),
      approvals: deps.listApprovals().filter((a) => a.status === "pending"),
      clientNotes: await deps.listClientNotes(),
      now: deps.now,
      timezone: deps.timezone,
    });
    return { name, summary: text };
  }

  if (name === "commitment-due-scan") {
    const lines = dueLines(deps.listCommitments(), deps.now);
    return { name, summary: lines.length > 0 ? lines.join("\n") : "Обязательств к проверке нет." };
  }

  // anomaly-scan
  const anomalies = deps.listAnomalies().filter((a) => a.status === "new");
  const lines: string[] = [];
  if (anomalies.length > 0) {
    lines.push("Аномалии:");
    for (const a of anomalies) lines.push(`- [${a.severity}] ${a.explanation}`);
  }
  // Deterministic detectors (the LLM may later explain, but not discover).
  const commitments = deps.listCommitments();
  const invoices = deps.listInvoices();
  const expenses = deps.listExpenses();
  const overdue = detectCommitmentOverdue(commitments, deps.now);
  const duplicates = detectDuplicateInvoices(
    invoices.map((i) => ({ id: i.id, vendor: i.vendor, amount: i.amount, currency: i.currency, date: i.dueDate })),
  );
  const spikes = detectExpenseOutliers(
    expenses.map((e) => ({ id: e.id, amount: e.amount, currency: e.currency, category: e.category, date: e.date })),
  );
  for (const a of [...overdue, ...duplicates, ...spikes]) {
    lines.push(`- [${a.severity}] ${a.explanation}`);
  }
  return { name, summary: lines.length > 0 ? lines.join("\n") : "Аномалий нет." };
}

export const DETERMINISTIC_TASK_NAMES: DeterministicTaskName[] = [
  "daily-briefing",
  "anomaly-scan",
  "commitment-due-scan",
];
