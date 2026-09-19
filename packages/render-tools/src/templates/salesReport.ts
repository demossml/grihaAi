import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { buildSalesReportSpec, type SalesReportPayload } from "./spec.js";

export async function renderSalesReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const payload: SalesReportPayload = {
    period: typeof data.period === "string" ? data.period : request.title,
    totalRevenue: typeof data.totalRevenue === "number" ? data.totalRevenue : 0,
    categories: Array.isArray(data.categories)
      ? (data.categories as SalesReportPayload["categories"])
      : [],
    topDeals: Array.isArray(data.topDeals) ? (data.topDeals as SalesReportPayload["topDeals"]) : [],
  };
  const buffer = await renderPdfBuffer(buildSalesReportSpec(payload));
  return { buffer, warnings: [] };
}
