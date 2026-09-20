/**
 * sales-report: сводка + таблица позиций + итог (layout kit).
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable } from "../layout/table.js";
import { formatMoney } from "../layout/format.js";

export interface SalesReportInput {
  title: string;
  periodLabel: string;
  generatedAtLabel: string;
  summary: { orders: number; units: number; revenueLabel: string };
  rows: Array<{ dateLabel: string; product: string; qty: number; amountLabel: string }>;
  totalLabel: string;
}

export function buildSalesReportSpec(input: SalesReportInput): Spec {
  return buildReportShellSpec(
    {
      documentTitle: input.title,
      subtitleLines: [
        input.periodLabel ? `Период: ${input.periodLabel}` : "",
        input.generatedAtLabel ? `Сформировано: ${input.generatedAtLabel}` : "",
      ].filter(Boolean),
    },
    (b: SpecBuilder) => {
      b.add("Heading", { text: "1. Сводка", level: "h2", color: REPORT_COLORS.accent });
      addReportTable(b, {
        columns: [
          { header: "Заказы", align: "center", width: "33%" },
          { header: "Единицы", align: "center", width: "34%" },
          { header: "Выручка", align: "right", width: "33%" },
        ],
        rows: [
          [String(input.summary.orders), String(input.summary.units), input.summary.revenueLabel],
        ],
      });
      b.add("Spacer", { height: 10 });

      b.add("Heading", { text: "2. Позиции", level: "h2", color: REPORT_COLORS.accent });
      if (input.rows.length > 0) {
        addReportTable(b, {
          columns: [
            { header: "Дата", align: "left", width: "20%" },
            { header: "Товар", align: "left", width: "45%" },
            { header: "Кол-во", align: "center", width: "15%" },
            { header: "Сумма", align: "right", width: "20%" },
          ],
          rows: input.rows.map((r) => [r.dateLabel, r.product, String(r.qty), r.amountLabel]),
        });
      } else {
        b.add("Text", { text: "Нет позиций.", fontSize: 10, color: REPORT_COLORS.muted });
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

function legacyToInput(data: Record<string, unknown>): SalesReportInput {
  const period = typeof data.period === "string" ? data.period : "";
  const totalRevenue = typeof data.totalRevenue === "number" ? data.totalRevenue : 0;
  const categories = Array.isArray(data.categories)
    ? (data.categories as Array<{ name?: string; revenue?: number }>)
    : [];
  const topDeals = Array.isArray(data.topDeals)
    ? (data.topDeals as Array<{ title?: string; amount?: number }>)
    : [];
  const revenueLabel = formatMoney(totalRevenue);
  return {
    title: "Отчёт по продажам",
    periodLabel: period,
    generatedAtLabel: "",
    summary: { orders: topDeals.length, units: 0, revenueLabel },
    rows: categories.map((c) => ({
      dateLabel: period,
      product: c.name ?? "без категории",
      qty: 0,
      amountLabel: formatMoney(c.revenue ?? 0),
    })),
    totalLabel: revenueLabel,
  };
}

export async function renderSalesReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const isRich =
    typeof data.summary === "object" ||
    Array.isArray(data.rows) ||
    typeof data.title === "string";

  const input: SalesReportInput = isRich
    ? {
        title: typeof data.title === "string" ? data.title : "Отчёт по продажам",
        periodLabel: typeof data.periodLabel === "string" ? data.periodLabel : "",
        generatedAtLabel: typeof data.generatedAtLabel === "string" ? data.generatedAtLabel : "",
        summary: (data.summary as SalesReportInput["summary"]) ?? { orders: 0, units: 0, revenueLabel: "0,00 ₽" },
        rows: Array.isArray(data.rows) ? (data.rows as SalesReportInput["rows"]) : [],
        totalLabel: typeof data.totalLabel === "string" ? data.totalLabel : "0,00 ₽",
      }
    : legacyToInput(data);

  const buffer = await renderPdfBuffer(buildSalesReportSpec(input));
  return { buffer, warnings: [] };
}
