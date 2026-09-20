/**
 * revenue-report: выручка по месяцам (таблица + bars — R5).
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable } from "../layout/table.js";
import { addHorizontalBarsTable } from "../layout/barChart.js";
import { parseMoneyLabel } from "../layout/format.js";

export interface RevenueReportInput {
  periodLabel: string;
  generatedAtLabel: string;
  byMonth: Array<{ monthLabel: string; revenueLabel: string; value?: number }>;
  totalLabel: string;
}

export function buildRevenueReportSpec(input: RevenueReportInput): Spec {
  return buildReportShellSpec(
    {
      documentTitle: "Отчёт по выручке",
      subtitleLines: [
        input.periodLabel ? `Период: ${input.periodLabel}` : "",
        input.generatedAtLabel ? `Сформировано: ${input.generatedAtLabel}` : "",
      ].filter(Boolean),
    },
    (b: SpecBuilder) => {
      if (input.byMonth.length > 0) {
        addReportTable(b, {
          columns: [
            { header: "Месяц", align: "left", width: "50%" },
            { header: "Выручка", align: "right", width: "50%" },
          ],
          rows: input.byMonth.map((m) => [m.monthLabel, m.revenueLabel]),
        });
      } else {
        b.add("Text", { text: "Нет данных по месяцам.", fontSize: 10, color: REPORT_COLORS.muted });
      }
      b.add("Spacer", { height: 8 });
      if (input.byMonth.length > 0) {
        addHorizontalBarsTable(
          b,
          input.byMonth.map((m) => ({
            label: m.monthLabel,
            value: m.value ?? parseMoneyLabel(m.revenueLabel),
            valueLabel: m.revenueLabel,
          })),
        );
      }
      b.add("Spacer", { height: 8 });
      b.add("Divider", { color: REPORT_COLORS.border, thickness: 1, marginTop: 4, marginBottom: 4 });
      b.add("Text", {
        text: `Итого: ${input.totalLabel}`,
        fontSize: 14,
        fontWeight: "bold",
        align: "right",
        color: REPORT_COLORS.dark,
      });
    },
  );
}

export async function renderRevenueReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const input: RevenueReportInput = {
    periodLabel: typeof data.periodLabel === "string" ? data.periodLabel : "",
    generatedAtLabel: typeof data.generatedAtLabel === "string" ? data.generatedAtLabel : "",
    byMonth: Array.isArray(data.byMonth) ? (data.byMonth as RevenueReportInput["byMonth"]) : [],
    totalLabel: typeof data.totalLabel === "string" ? data.totalLabel : "0,00 ₽",
  };
  const buffer = await renderPdfBuffer(buildRevenueReportSpec(input));
  return { buffer, warnings: [] };
}
