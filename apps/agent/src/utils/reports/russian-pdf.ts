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
}

export interface ExpensePdfOptions {
  title: string;
  /** «весь период» или «2026-01-01 — 2026-03-01». */
  periodLabel: string;
  rows: ExpensePdfRow[];
  totalAmount: number;
  currency: string;
  /** Override каталога (тесты). */
  outputDir?: string;
  /** Override кандидатов шрифта (тесты). */
  fontCandidates?: string[];
}

/**
 * Рендер отчёта по расходам с кириллицей: title, период, таблица
 * date | supplier | total, footer count + сумма ru-RU.
 */
export async function renderExpensePdfRussian(opts: ExpensePdfOptions): Promise<string> {
  await ensureRussianFont(opts.fontCandidates);
  const { createElement: h } = await import("react");
  const { Document, Page, Text, View, StyleSheet, renderToFile } = await import(
    "@react-pdf/renderer"
  );

  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: "DejaVu", fontSize: 11, color: "#1a1a1a" },
    title: { fontSize: 18, fontWeight: "bold", color: "#1f3864", marginBottom: 4 },
    period: { fontSize: 11, color: "#555", marginBottom: 16 },
    headerRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333", paddingVertical: 4, fontWeight: "bold" },
    row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd", paddingVertical: 4 },
    colDate: { flex: 2 },
    colSupplier: { flex: 5 },
    colAmount: { flex: 2, textAlign: "right" },
    footer: { marginTop: 16, fontSize: 12, fontWeight: "bold" },
  });

  const doc = h(
    Document,
    null,
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.title }, opts.title),
      h(Text, { style: styles.period }, `Период: ${opts.periodLabel}`),
      h(
        View,
        { style: styles.headerRow },
        h(Text, { style: styles.colDate }, "Дата"),
        h(Text, { style: styles.colSupplier }, "Поставщик"),
        h(Text, { style: styles.colAmount }, "Сумма"),
      ),
      ...opts.rows.map((r, i) =>
        h(
          View,
          { key: i, style: styles.row, wrap: false },
          h(Text, { style: styles.colDate }, r.date),
          h(
            Text,
            { style: styles.colSupplier },
            `${r.supplier ?? "?"}${r.needsReview ? " (проверка)" : ""}`,
          ),
          h(
            Text,
            { style: styles.colAmount },
            r.total != null ? `${formatRuMoney(r.total)} ${r.currency ?? opts.currency}` : "—",
          ),
        ),
      ),
      h(
        Text,
        { style: styles.footer },
        `Итого: ${opts.rows.length} записей · ${formatRuMoney(opts.totalAmount)} ${opts.currency}`,
      ),
    ),
  );

  const dir = opts.outputDir ?? REPORTS_DIR;
  await fs.promises.mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, `${randomUUID()}.pdf`);
  await renderToFile(doc, outputPath);
  return outputPath;
}
