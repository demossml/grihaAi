import type { Anomaly, Commitment } from "../types/index.js";

/**
 * Anomaly watch — pure detectors. Each returns anomaly records (without ids;
 * the service assigns ids and persistence). Detection must never fire on mere
 * differences: it requires a baseline/threshold and an explanation.
 */

export interface AnomalyInput {
  userId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  explanation: string;
  evidence: Record<string, unknown>;
}

export interface ExpenseLike {
  id: string;
  amount: number;
  currency: string;
  category?: string;
  date?: string;
}

/** Overdue commitments → critical anomalies (one per overdue commitment). */
export function detectCommitmentOverdue(commitments: Commitment[], now: Date = new Date()): AnomalyInput[] {
  const out: AnomalyInput[] = [];
  for (const c of commitments) {
    if (c.status !== "overdue") continue;
    const due = c.dueDate ? new Date(c.dueDate).getTime() : undefined;
    const daysOverdue = due ? Math.max(1, Math.floor((now.getTime() - due) / (24 * 60 * 60 * 1000))) : 1;
    out.push({
      userId: c.userId,
      type: "commitment_overdue",
      severity: daysOverdue > 3 ? "critical" : "warning",
      explanation: `Обязательство просрочено${daysOverdue > 1 ? ` на ${daysOverdue} дн.` : ""}: ${c.text}`,
      evidence: { commitmentId: c.id, dueDate: c.dueDate },
    });
  }
  return out;
}

/** Duplicate invoices — same vendor + amount within a short window. */
export interface InvoiceLike {
  id: string;
  vendor?: string;
  amount: number;
  currency: string;
  date?: string;
}

export function detectDuplicateInvoices(invoices: InvoiceLike[]): AnomalyInput[] {
  const out: AnomalyInput[] = [];
  const seen = new Map<string, InvoiceLike>();
  for (const inv of invoices) {
    const key = `${inv.vendor ?? ""}|${inv.currency}|${inv.amount}`;
    const prev = seen.get(key);
    if (prev && prev.id !== inv.id) {
      out.push({
        userId: "owner",
        type: "duplicate_invoice",
        severity: "warning",
        explanation: `Возможный дубликат счёта: ${prev.vendor ?? "vendor"} ${inv.amount} ${inv.currency}`,
        evidence: { invoiceIds: [prev.id, inv.id] },
      });
    }
    seen.set(key, inv);
  }
  return out;
}

/**
 * Expense outlier — flag an expense whose amount exceeds the historical
 * average by the given multiplier (baseline-based, not "differs ⇒ anomaly").
 */
export function detectExpenseOutliers(
  expenses: ExpenseLike[],
  options: { multiplier?: number; minAmountToFlag?: number } = {},
): AnomalyInput[] {
  const multiplier = options.multiplier ?? 3;
  const minAmountToFlag = options.minAmountToFlag ?? 0;
  const amounts = expenses.map((e) => e.amount).filter((a) => Number.isFinite(a));
  if (amounts.length < 3) return [];
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  if (avg <= 0) return [];

  const out: AnomalyInput[] = [];
  for (const e of expenses) {
    if (e.amount >= minAmountToFlag && e.amount > avg * multiplier) {
      out.push({
        userId: "owner",
        type: "expense_spike",
        severity: "warning",
        explanation: `Расход заметно выше baseline: ${e.amount} ${e.currency} при среднем ~${avg.toFixed(2)}`,
        evidence: { expenseId: e.id, amount: e.amount, baseline: avg },
      });
    }
  }
  return out;
}

/** Map an AnomalyInput to a persisted Anomaly (id assigned by the caller). */
export function toAnomaly(id: string, input: AnomalyInput, detectedAt: string): Anomaly {
  return {
    id,
    userId: input.userId,
    type: input.type,
    severity: input.severity,
    detectedAt,
    explanation: input.explanation,
    evidence: input.evidence,
    status: "new",
  };
}
