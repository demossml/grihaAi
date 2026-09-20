/**
 * Горизонтальные bars без браузера/chart-либ: текстовые блоки "█",
 * масштабированные по максимуму. Встраиваются в таблицу под основными данными.
 */
import { SpecBuilder } from "../templates/spec.js";
import { REPORT_COLORS } from "./tokens.js";

export interface HorizontalBarItem {
  label: string;
  value: number;
  valueLabel: string;
}

export const BAR_BLOCK = "█";
export const DEFAULT_MAX_BLOCKS = 30;

/** Текст бара: "█" × round(value/maxV * maxBlocks). */
export function buildBarText(value: number, maxV: number, maxBlocks = DEFAULT_MAX_BLOCKS): string {
  if (maxV <= 0) return "";
  const ratio = value / maxV;
  const n = Math.max(0, Math.min(maxBlocks, Math.round(ratio * maxBlocks)));
  return BAR_BLOCK.repeat(n);
}

/** Строки таблицы для bars: [label, barText, valueLabel]. */
export function buildHorizontalBars(
  items: HorizontalBarItem[],
  _opts?: { maxWidthMm?: number },
): string[][] {
  const maxV = Math.max(1, ...items.map((i) => i.value));
  return items.map((i) => [i.label, buildBarText(i.value, maxV), i.valueLabel]);
}

/** Колонки таблицы bars (label | bar | value). */
export const BAR_COLUMNS: Array<{ header: string; width: string; align: "left" | "right" }> = [
  { header: "", width: "34%", align: "left" },
  { header: "", width: "50%", align: "left" },
  { header: "", width: "16%", align: "right" },
];

/** Добавить таблицу bars (без тёмной шапки) в builder; возвращает id. */
export function addHorizontalBarsTable(
  b: SpecBuilder,
  items: HorizontalBarItem[],
  opts?: { fontSize?: number },
): string {
  return b.add("Table", {
    columns: BAR_COLUMNS,
    rows: buildHorizontalBars(items),
    headerBackgroundColor: "#ffffff",
    headerTextColor: REPORT_COLORS.text,
    borderColor: REPORT_COLORS.border,
    fontSize: opts?.fontSize ?? 9,
  });
}
