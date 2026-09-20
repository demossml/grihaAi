/**
 * generic-table-report: произвольная таблица по колонкам (columns + rows).
 */
import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { SpecBuilder, type Spec } from "./spec.js";
import { REPORT_COLORS } from "../layout/tokens.js";
import { buildReportShellSpec } from "../layout/shell.js";
import { addReportTable, type TableAlign } from "../layout/table.js";

export interface GenericTableColumn {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  width?: string;
}

export interface GenericTableReportInput {
  title: string;
  subtitleLines: string[];
  columns: GenericTableColumn[];
  rows: Array<Record<string, string>>;
  footerNote?: string;
}

export function buildGenericTableReportSpec(input: GenericTableReportInput): Spec {
  return buildReportShellSpec(
    {
      documentTitle: input.title,
      subtitleLines: input.subtitleLines,
      footerText: input.footerNote,
    },
    (b: SpecBuilder) => {
      if (input.columns.length === 0 || input.rows.length === 0) {
        b.add("Text", { text: "Нет данных.", fontSize: 10, color: REPORT_COLORS.muted });
        return;
      }
      addReportTable(b, {
        columns: input.columns.map((c) => ({
          header: c.header,
          align: (c.align ?? "left") as TableAlign,
          width: c.width,
        })),
        rows: input.rows.map((row) => input.columns.map((c) => row[c.key] ?? "")),
      });
    },
  );
}

export async function renderGenericTableReport(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const input: GenericTableReportInput = {
    title: typeof data.title === "string" ? data.title : (request.title ?? "Таблица"),
    subtitleLines: Array.isArray(data.subtitleLines) ? (data.subtitleLines as string[]) : [],
    columns: Array.isArray(data.columns) ? (data.columns as GenericTableColumn[]) : [],
    rows: Array.isArray(data.rows) ? (data.rows as Array<Record<string, string>>) : [],
    footerNote: typeof data.footerNote === "string" ? data.footerNote : undefined,
  };
  const buffer = await renderPdfBuffer(buildGenericTableReportSpec(input));
  return { buffer, warnings: [] };
}
