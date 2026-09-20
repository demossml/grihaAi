/**
 * Общий «Page shell» для отчётов: шапка (title + meta + HR) и подвал
 * (footer text + номер страницы). Контент вставляется через callback.
 */
import { SpecBuilder, type Spec } from "../templates/spec.js";
import { PAGE, REPORT_COLORS } from "./tokens.js";

const MM_TO_PT = 2.83465;

function mm(value: number): number {
  return Math.round(value * MM_TO_PT);
}

export interface ReportShellOptions {
  documentTitle: string;
  /** Группа, период, дата формирования — строки meta под title. */
  subtitleLines: string[];
  footerText?: string;
}

/** Шапка: title (bold, тёмный) + meta-строки (9 muted) + HR. */
export function addReportHeader(b: SpecBuilder, opts: ReportShellOptions): void {
  b.add("Heading", { text: opts.documentTitle, level: "h1", color: REPORT_COLORS.dark });
  for (const line of opts.subtitleLines) {
    b.add("Text", { text: line, fontSize: 9, color: REPORT_COLORS.muted });
  }
  b.add("Divider", { color: REPORT_COLORS.border, thickness: 1, marginTop: 6, marginBottom: 10 });
}

/** Подвал: HR + footer text + номер страницы (центр, muted). */
export function addReportFooter(b: SpecBuilder, opts: ReportShellOptions): void {
  b.add("Spacer", { height: 12 });
  b.add("Divider", { color: REPORT_COLORS.border, thickness: 0.5, marginTop: 4, marginBottom: 4 });
  if (opts.footerText) {
    b.add("Text", { text: opts.footerText, fontSize: 8, color: REPORT_COLORS.muted, align: "center" });
  }
  b.add("PageNumber", {
    format: "{pageNumber} / {totalPages}",
    fontSize: 8,
    color: REPORT_COLORS.muted,
    align: "center",
  });
}

/**
 * Собрать полный spec документа: Page(A4) → header → content → footer.
 * `buildContent` получает builder с установленным parent=Page.
 */
export function buildReportShellSpec(
  opts: ReportShellOptions,
  buildContent: (b: SpecBuilder) => void,
): Spec {
  const b = new SpecBuilder();
  const page = b.add("Page", {
    size: PAGE.size,
    marginTop: mm(PAGE.marginMm),
    marginBottom: mm(PAGE.marginMm),
    marginLeft: mm(PAGE.marginMm),
    marginRight: mm(PAGE.marginMm),
  });
  b.setParent(page);
  addReportHeader(b, opts);
  buildContent(b);
  addReportFooter(b, opts);
  b.setParent(null);
  const doc = b.add("Document", { title: opts.documentTitle }, [page]);
  return b.build(doc);
}
