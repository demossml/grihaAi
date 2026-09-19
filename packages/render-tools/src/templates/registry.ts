import type { RenderRequest } from "@griha/render-contracts";
import { renderExpenseReport } from "./expenseReport.js";
import { renderSalesReport } from "./salesReport.js";
import { renderMeetingMinutes } from "./meetingMinutes.js";

export type TemplateRenderer = (
  request: RenderRequest,
) => Promise<{ buffer: Buffer; warnings: string[]; pages?: number }>;

const registry = new Map<string, TemplateRenderer>([
  ["sales-report", renderSalesReport],
  ["expense-report", renderExpenseReport],
  ["meeting-minutes", renderMeetingMinutes],
]);

export function getRenderer(name: string): TemplateRenderer | undefined {
  return registry.get(name);
}

export function listTemplates(): string[] {
  return [...registry.keys()];
}
