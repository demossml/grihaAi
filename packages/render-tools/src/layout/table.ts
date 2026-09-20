/**
 * Табличный helper: тёмная шапка (#2d3748, белый текст), границы,
 * полосатые чётные строки, выравнивание колонок left|center|right.
 */
import { SpecBuilder } from "../templates/spec.js";
import { REPORT_COLORS } from "./tokens.js";

export type TableAlign = "left" | "center" | "right";

export interface ReportTableColumn {
  header: string;
  align?: TableAlign;
  width?: string;
}

export interface ReportTableOptions {
  columns: ReportTableColumn[];
  rows: string[][];
  fontSize?: number;
}

/** Добавить стилизованную таблицу в builder; возвращает id элемента. */
export function addReportTable(b: SpecBuilder, opts: ReportTableOptions): string {
  return b.add("Table", {
    columns: opts.columns,
    rows: opts.rows,
    headerBackgroundColor: REPORT_COLORS.dark,
    headerTextColor: REPORT_COLORS.white,
    borderColor: REPORT_COLORS.border,
    fontSize: opts.fontSize ?? 10,
    striped: true,
  });
}
