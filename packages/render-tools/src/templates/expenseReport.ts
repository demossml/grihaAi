import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { buildExpenseReportSpec, type ExpenseReportPayload } from "./spec.js";

export async function renderExpenseReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const payload: ExpenseReportPayload = {
    period: typeof data.period === "string" ? data.period : request.title,
    totalAmount: typeof data.totalAmount === "number" ? data.totalAmount : 0,
    categories: Array.isArray(data.categories)
      ? (data.categories as ExpenseReportPayload["categories"])
      : [],
    items: Array.isArray(data.items) ? (data.items as ExpenseReportPayload["items"]) : [],
  };
  const buffer = await renderPdfBuffer(buildExpenseReportSpec(payload));
  return { buffer, warnings: [] };
}
