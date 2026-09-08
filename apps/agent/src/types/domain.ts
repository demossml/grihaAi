/**
 * Domain contracts — canonical shapes for structured state.
 *
 * These are the *contracts* the domain services implement. They deliberately
 * reference the runtime types in `./index.js` rather than redefining them, so
 * there is a single source of truth. Memory (knowledge/preferences/history) is
 * a separate concern from these structured business records.
 */

import type {
  ApprovalRequestRecord,
  CalendarEvent,
  Commitment,
  Contact,
  Expense,
  Invoice,
} from "./index.js";

/** Commitment — an obligation with an actor, action, target and deadline. */
export type CommitmentContract = Commitment;

/** Approval — an explicit confirmation bound to user/session/action/scope. */
export type ApprovalContract = ApprovalRequestRecord;

/** Anomaly — a detected deviation with evidence and explanation. */
export interface AnomalyContract {
  id: string;
  userId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  detectedAt: string;
  explanation: string;
  evidence: Record<string, unknown>;
  status: "new" | "acknowledged" | "resolved";
}

/** Briefing — an aggregated item for the daily briefing. */
export interface BriefingContract {
  id: string;
  userId: string;
  dayKey: string;
  text: string;
  ranAt: string;
}

/** Meeting — a calendar event of kind "meeting" with agenda/participants. */
export type MeetingContract = CalendarEvent;

/** Contact — structured client identity (notes live separately). */
export type ContactContract = Contact;

/** Invoice — a payable document with a lifecycle. */
export type InvoiceContract = Invoice;

/** Expense — a recorded spend. */
export type ExpenseContract = Expense;

/** Task — a unit of work delegated to a sub-agent or cron. */
export interface TaskContract {
  id: string;
  userId: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  finishedAt?: string;
}

/** Re-export the runtime types so consumers import from one module. */
export type {
  ApprovalRequestRecord,
  CalendarEvent,
  Commitment,
  Contact,
  Expense,
  Invoice,
};
