/**
 * sellers-report: продажи по продавцам (таблица + доля %). Bars — в R5.
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable } from "../layout/table.js";
import { addHorizontalBarsTable } from "../layout/barChart.js";

export interface SellersReportInput {
  periodLabel: string;
  generatedAtLabel: string;
  rows: Array<{ seller: string; deals: number; revenueLabel: string; sharePercent: number }>;
  totalLabel: string;
}

export function buildSellersReportSpec(input: SellersReportInput): Spec {
  return buildReportShellSpec(
    {
      documentTitle: "Отчёт по продавцам",
      subtitleLines: [
        input.periodLabel ? `Период: ${input.periodLabel}` : "",
        input.generatedAtLabel ? `Сформировано: ${input.generatedAtLabel}` : "",
      ].filter(Boolean),
    },
    (b: SpecBuilder) => {
      if (input.rows.length > 0) {
        addReportTable(b, {
          columns: [
            { header: "Продавец", align: "left", width: "40%" },
            { header: "Сделок", align: "center", width: "15%" },
            { header: "Выручка", align: "right", width: "25%" },
            { header: "Доля %", align: "right", width: "20%" },
          ],
          rows: input.rows.map((r) => [
            r.seller,
            String(r.deals),
            r.revenueLabel,
            `${r.sharePercent}%`,
          ]),
        });
      } else {
        b.add("Text", { text: "Нет данных по продавцам.", fontSize: 10, color: REPORT_COLORS.muted });
      }
      b.add("Spacer", { height: 8 });
      if (input.rows.length > 0) {
        addHorizontalBarsTable(
          b,
          input.rows.map((r) => ({
            label: r.seller,
            value: r.sharePercent,
            valueLabel: `${r.sharePercent}%`,
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

export async function renderSellersReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const input: SellersReportInput = {
    periodLabel: typeof data.periodLabel === "string" ? data.periodLabel : "",
    generatedAtLabel: typeof data.generatedAtLabel === "string" ? data.generatedAtLabel : "",
    rows: Array.isArray(data.rows) ? (data.rows as SellersReportInput["rows"]) : [],
    totalLabel: typeof data.totalLabel === "string" ? data.totalLabel : "0,00 ₽",
  };
  const buffer = await renderPdfBuffer(buildSellersReportSpec(input));
  return { buffer, warnings: [] };
}
