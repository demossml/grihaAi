/**
 * Агрегация: поставщики и сводка (чистые функции row[] → DTO).
 */
import type { CompactExpenseReport, ExpenseRow, ReportSupplierAgg } from "../types.js";
import { classifyProblem } from "../problems.js";

export function aggregateSuppliers(rows: ExpenseRow[]): ReportSupplierAgg[] {
  const map = new Map<string, { count: number; total: number; currency: string }>();
  for (const r of rows) {
    const key = r.supplier?.trim() || "без названия";
    const cur = map.get(key) ?? { count: 0, total: 0, currency: r.currency || "RUB" };
    cur.count += 1;
    if (r.total != null && !Number.isNaN(r.total)) cur.total += r.total;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([supplier, v]) => ({
      supplier,
      documentCount: v.count,
      total: v.total,
      currency: v.currency,
    }))
    .sort((a, b) => b.total - a.total);
}

export function buildSummary(rows: ExpenseRow[]): CompactExpenseReport["summary"] {
  const withTotal = rows.filter((r) => r.total != null && !Number.isNaN(r.total));
  const totalSum = withTotal.reduce((a, r) => a + (r.total as number), 0);
  const problemCount = rows.filter((r) => classifyProblem(r).length > 0).length;
  const currencies = new Set(withTotal.map((r) => r.currency || "RUB"));
  const currency =
    withTotal.length === 0 ? "RUB" : currencies.size === 1 ? withTotal[0].currency || "RUB" : "RUB";
  return {
    documentCount: rows.length,
    withTotalCount: withTotal.length,
    totalSum,
    currency,
    problemCount,
  };
}
