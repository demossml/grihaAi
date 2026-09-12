/**
 * Русские PDF через @react-pdf/renderer с встроенным кириллическим TTF.
 *
 * R2: Helvetica (стандартные 14 шрифтов PDF) НЕ содержит кириллицу. Здесь —
 * кастомное имя шрифта «DejaVu» (нельзя перезаписать стандартный Helvetica —
 * react-pdf игнорирует такую регистрацию). Путь к TTF конфигурируем через
 * AGENT_RUSSIAN_FONT_PATH; fallback — системные DejaVu/Liberation/Arial Unicode.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { REPORTS_DIR } from "./report-renderer.js";

const FONT_CANDIDATES: string[] = [
  process.env.AGENT_RUSSIAN_FONT_PATH ?? "",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  // macOS: Arial Unicode содержит кириллицу (fallback для локальной разработки).
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
].filter(Boolean);

/** Первый существующий кандидат шрифта (или undefined). */
export function findRussianFontPath(candidates: string[] = FONT_CANDIDATES): string | undefined {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* следующий кандидат */
    }
  }
  return undefined;
}

let registeredFontPath: string | undefined;

/** Регистрирует шрифт «DejaVu» один раз; без шрифта — явная ошибка (не пустой PDF). */
async function ensureRussianFont(candidates?: string[]): Promise<string> {
  const fontPath = findRussianFontPath(candidates);
  if (!fontPath) throw new Error("Нет кириллического шрифта для PDF");
  const { Font } = await import("@react-pdf/renderer");
  if (registeredFontPath !== fontPath) {
    Font.register({ family: "DejaVu", src: fontPath });
    Font.registerHyphenationCallback((word: string) => [word]);
    registeredFontPath = fontPath;
  }
  return fontPath;
}

export function formatRuMoney(n: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export interface ExpensePdfRow {
  /** YYYY-MM-DD */
  date: string;
  supplier?: string;
  total?: number;
  currency?: string;
  needsReview?: boolean;
  /** Свободная категория (F3). */
  category?: string | null;
  tags?: string[];
}

/** Секция разреза отчёта: имя измерения + под-итог. */
export interface ExpensePdfSection {
  label: string;
  rows: ExpensePdfRow[];
  subtotal: number;
}

export interface ExpensePdfOptions {
  /** F7: «Отчёт по расходам — группа «{chatTitle}»» (не chatId). */
  chatTitle: string;
  /** «весь период» или «2026-01-01 — 2026-03-01». */
  periodLabel: string;
  /** Разрез: supplier | category | tag | none (свободная строка). */
  dimension?: string;
  /** Секции с под-итогами; при отсутствии — одна секция «Все записи». */
  sections?: ExpensePdfSection[];
  rows: ExpensePdfRow[];
  totalAmount: number;
  currency: string;
  /** Override каталога (тесты). */
  outputDir?: string;
  /** Override кандидатов шрифта (тесты). */
  fontCandidates?: string[];
}

const DARK = "#1F3864";
const GREEN = "#2E9E5B";
const ROW_ALT = "#EEF2F8";

/**
 * Рендер отчёта по расходам (F7): заголовок 20pt с названием группы,
 * период/разрез, секции с под-итогами, таблица с чередованием строк,
 * зелёный блок ИТОГО.
 */
export async function renderExpensePdfRussian(opts: ExpensePdfOptions): Promise<string> {
  await ensureRussianFont(opts.fontCandidates);
  const { createElement: h } = await import("react");
  const { Document, Page, Text, View, StyleSheet, renderToFile } = await import(
    "@react-pdf/renderer"
  );

  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: "DejaVu", fontSize: 10, color: "#1a1a1a" },
    title: { fontSize: 20, fontWeight: "bold", color: DARK, marginBottom: 4 },
    subtitle: { fontSize: 12, color: "#555555", marginBottom: 4 },
    headerRow: {
      flexDirection: "row",
      backgroundColor: DARK,
      color: "#ffffff",
      paddingVertical: 5,
      paddingHorizontal: 6,
      fontWeight: "bold",
    },
    row: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6 },
    rowAlt: {
      flexDirection: "row",
      paddingVertical: 4,
      paddingHorizontal: 6,
      backgroundColor: ROW_ALT,
    },
    colDate: { flex: 1.6 },
    colSupplier: { flex: 3.4 },
    colCategory: { flex: 2.4 },
    colAmount: { flex: 1.8, textAlign: "right" },
    section: { marginTop: 12, marginBottom: 2 },
    sectionLabel: { fontSize: 12, fontWeight: "bold", color: DARK, marginBottom: 3 },
    sectionSubtotal: { fontSize: 10, color: "#333333", textAlign: "right", marginBottom: 2 },
    totalBox: {
      marginTop: 18,
      backgroundColor: GREEN,
      color: "#ffffff",
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontSize: 12,
      fontWeight: "bold",
    },
  });

  const showCategoryCol = opts.dimension === "category";
  const extraHeader = showCategoryCol
    ? h(Text, { key: "c", style: styles.colCategory }, "Категория")
    : null;
  const headerCells = [
    h(Text, { key: "d", style: styles.colDate }, "Дата"),
    h(Text, { key: "s", style: styles.colSupplier }, "Поставщик"),
    ...(extraHeader ? [extraHeader] : []),
    h(Text, { key: "a", style: styles.colAmount }, "Сумма"),
  ];

  const rowView = (r: ExpensePdfRow, i: number) =>
    h(
      View,
      { key: i, style: i % 2 === 0 ? styles.row : styles.rowAlt, wrap: false },
      h(Text, { style: styles.colDate }, r.date),
      h(
        Text,
        { style: styles.colSupplier },
        `${r.supplier ?? "?"}${r.needsReview ? " (проверка)" : ""}`,
      ),
      ...(showCategoryCol
        ? [h(Text, { key: "cat", style: styles.colCategory }, r.category ?? "—")]
        : []),
      h(
        Text,
        { style: styles.colAmount },
        r.total != null ? `${formatRuMoney(r.total)} ${r.currency ?? opts.currency}` : "—",
      ),
    );

  const dimensionLabel =
    opts.dimension === "supplier"
      ? "по поставщикам"
      : opts.dimension === "category"
        ? "по категориям"
        : opts.dimension === "tag"
          ? "по тегам"
          : opts.dimension && opts.dimension !== "none"
            ? `по «${opts.dimension}»`
            : "без разреза";

  const sections = opts.sections ?? [
    { label: "Все записи", rows: opts.rows, subtotal: opts.totalAmount },
  ];

  const doc = h(
    Document,
    null,
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.title }, `Отчёт по расходам — группа «${opts.chatTitle}»`),
      h(Text, { style: styles.subtitle }, `Период: ${opts.periodLabel} · Разрез: ${dimensionLabel}`),
      ...sections.flatMap((section, si) => [
        h(
          View,
          { key: `s${si}`, style: styles.section },
          h(Text, { style: styles.sectionLabel }, section.label),
          h(
            Text,
            { style: styles.sectionSubtotal },
            `Под-итог: ${formatRuMoney(section.subtotal)} ${opts.currency}`,
          ),
        ),
        h(View, { key: `h${si}`, style: styles.headerRow }, headerCells),
        ...section.rows.map((r, i) => rowView(r, i)),
      ]),
      h(
        View,
        { style: styles.totalBox },
        h(
          Text,
          null,
          `ИТОГО: ${sections.reduce((a, s) => a + s.rows.length, 0)} записей · ${formatRuMoney(opts.totalAmount)} ${opts.currency}`,
        ),
      ),
    ),
  );

  const dir = opts.outputDir ?? REPORTS_DIR;
  await fs.promises.mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, `${randomUUID()}.pdf`);
  await renderToFile(doc, outputPath);
  return outputPath;
}
