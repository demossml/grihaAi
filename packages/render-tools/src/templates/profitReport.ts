/**
 * profit-report: KPI (выручка/себестоимость/OPEX/прибыль) + маржа + breakdown.
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable } from "../layout/table.js";

export interface ProfitReportInput {
  periodLabel: string;
  generatedAtLabel: string;
  revenueLabel: string;
  cogsLabel: string;
  opexLabel: string;
  profitLabel: string;
  marginPercentLabel: string;
  rows?: Array<{ category: string; amountLabel: string }>;
}

export function buildProfitReportSpec(input: ProfitReportInput): Spec {
  return buildReportShellSpec(
    {
      documentTitle: "Отчёт по прибыли",
      subtitleLines: [
        input.periodLabel ? `Период: ${input.periodLabel}` : "",
        input.generatedAtLabel ? `Сформировано: ${input.generatedAtLabel}` : "",
      ].filter(Boolean),
    },
    (b: SpecBuilder) => {
      b.add("Heading", { text: "1. Ключевые показатели", level: "h2", color: REPORT_COLORS.accent });
      addReportTable(b, {
        columns: [
          { header: "Выручка", align: "right", width: "25%" },
          { header: "Себестоимость", align: "right", width: "25%" },
          { header: "OPEX", align: "right", width: "25%" },
          { header: "Прибыль", align: "right", width: "25%" },
        ],
        rows: [[input.revenueLabel, input.cogsLabel, input.opexLabel, input.profitLabel]],
      });
      b.add("Spacer", { height: 8 });
      b.add("Text", {
        text: `Маржа: ${input.marginPercentLabel}`,
        fontSize: 12,
        fontWeight: "bold",
        color: REPORT_COLORS.dark,
      });
      b.add("Spacer", { height: 10 });

      if (input.rows && input.rows.length > 0) {
        b.add("Heading", { text: "2. Разбивка", level: "h2", color: REPORT_COLORS.accent });
        addReportTable(b, {
          columns: [
            { header: "Категория", align: "left", width: "60%" },
            { header: "Сумма", align: "right", width: "40%" },
          ],
          rows: input.rows.map((r) => [r.category, r.amountLabel]),
        });
      }
    },
  );
}

export async function renderProfitReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const input: ProfitReportInput = {
    periodLabel: typeof data.periodLabel === "string" ? data.periodLabel : "",
    generatedAtLabel: typeof data.generatedAtLabel === "string" ? data.generatedAtLabel : "",
    revenueLabel: typeof data.revenueLabel === "string" ? data.revenueLabel : "0,00 ₽",
    cogsLabel: typeof data.cogsLabel === "string" ? data.cogsLabel : "0,00 ₽",
    opexLabel: typeof data.opexLabel === "string" ? data.opexLabel : "0,00 ₽",
    profitLabel: typeof data.profitLabel === "string" ? data.profitLabel : "0,00 ₽",
    marginPercentLabel: typeof data.marginPercentLabel === "string" ? data.marginPercentLabel : "0%",
    rows: Array.isArray(data.rows) ? (data.rows as ProfitReportInput["rows"]) : undefined,
  };
  const buffer = await renderPdfBuffer(buildProfitReportSpec(input));
  return { buffer, warnings: [] };
}
