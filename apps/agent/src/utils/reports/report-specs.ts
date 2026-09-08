import type {
  ExpenseReportData,
  MeetingMinutesData,
  ReportType,
  SalesReportData,
} from "./report-schemas.js";

/**
 * PDF report builders: data → json-render spec.
 *
 * Each builder produces a flat { root, elements } spec using ONLY the standard
 * component catalog (@json-render/react-pdf: Document, Page, Heading, Text,
 * Table, List, Divider, Spacer). There is no free-form markup: the component
 * catalog physically does not allow arbitrary layout, so an LLM cannot break
 * the template — it can only fill the same fixed slots.
 *
 * Structure and data mirror the old Handlebars templates
 * (sales-report.html / expense-report.html / meeting-minutes.html), including
 * the palette from their CSS variables.
 */

/** One node of the spec tree. */
export interface ReportSpecElement {
  type: string;
  props?: Record<string, unknown>;
  children: string[];
}

/** Flat json-render spec: root id + elements map. */
export interface ReportSpec {
  root: string;
  elements: Record<string, ReportSpecElement>;
}

/** Palette carried over from the old templates' CSS variables. */
export const REPORT_COLORS = {
  ink: "#1a1a1a",
  muted: "#555555",
  accent: "#1f3864",
  line: "#dddddd",
} as const;

const PAGE_MARGINS = { marginTop: 32, marginBottom: 32, marginLeft: 40, marginRight: 40 } as const;

class SpecBuilder {
  private elements: Record<string, ReportSpecElement> = {};
  private n = 0;

  add(type: string, props?: Record<string, unknown>, children: string[] = []): string {
    const id = `el-${++this.n}`;
    this.elements[id] = props ? { type, props, children } : { type, children };
    return id;
  }

  build(root: string): ReportSpec {
    return { root, elements: this.elements };
  }
}

/** Section heading + underline divider (same rhythm as the old h2 + border-bottom). */
function section(b: SpecBuilder, title: string): void {
  b.add("Heading", { text: title, level: "h2", color: REPORT_COLORS.accent });
  b.add("Divider", { color: REPORT_COLORS.line, marginTop: 4, marginBottom: 8 });
}

export function buildSalesReportSpec(data: SalesReportData): ReportSpec {
  const b = new SpecBuilder();
  const page = b.add("Page", { size: "A4", ...PAGE_MARGINS });

  b.add("Heading", { text: "Отчёт о продажах", level: "h1", color: REPORT_COLORS.accent }, []);
  b.add("Text", { text: `Период: ${data.period}`, color: REPORT_COLORS.muted, fontSize: 13 });
  b.add("Spacer", { height: 16 });

  section(b, "Итоговая выручка");
  b.add("Text", {
    text: String(data.totalRevenue),
    fontSize: 28,
    fontWeight: "bold",
    color: REPORT_COLORS.ink,
  });
  b.add("Spacer", { height: 16 });

  section(b, "Выручка по категориям");
  b.add("Table", {
    columns: [
      { header: "Категория", width: "60%", align: "left" },
      { header: "Выручка", width: "40%", align: "right" },
    ],
    rows: data.categories.map((c) => [c.name, String(c.revenue)]),
    headerTextColor: REPORT_COLORS.muted,
    borderColor: REPORT_COLORS.line,
    fontSize: 13,
  });
  b.add("Spacer", { height: 16 });

  section(b, "Топ сделки");
  b.add("List", {
    items: data.topDeals.map((d) => `${d.title} — ${d.amount}`),
    ordered: true,
    fontSize: 13,
    spacing: 6,
    color: REPORT_COLORS.ink,
  });

  const doc = b.add("Document", { title: "Отчёт о продажах" }, [page]);
  return b.build(doc);
}

export function buildExpenseReportSpec(data: ExpenseReportData): ReportSpec {
  const b = new SpecBuilder();
  const page = b.add("Page", { size: "A4", ...PAGE_MARGINS });

  b.add("Heading", { text: "Отчёт о расходах", level: "h1", color: REPORT_COLORS.accent });
  b.add("Text", { text: `Период: ${data.period}`, color: REPORT_COLORS.muted, fontSize: 13 });
  b.add("Spacer", { height: 16 });

  section(b, "Итоговая сумма");
  b.add("Text", {
    text: String(data.totalAmount),
    fontSize: 28,
    fontWeight: "bold",
    color: REPORT_COLORS.ink,
  });
  b.add("Spacer", { height: 16 });

  section(b, "Категории расходов");
  b.add("Table", {
    columns: [
      { header: "Категория", width: "60%", align: "left" },
      { header: "Сумма", width: "40%", align: "right" },
    ],
    rows: data.categories.map((c) => [c.name, String(c.amount)]),
    headerTextColor: REPORT_COLORS.muted,
    borderColor: REPORT_COLORS.line,
    fontSize: 13,
  });
  b.add("Spacer", { height: 16 });

  section(b, "Список трат");
  b.add("Table", {
    columns: [
      { header: "Дата", width: "20%", align: "left" },
      { header: "Категория", width: "20%", align: "left" },
      { header: "Описание", width: "40%", align: "left" },
      { header: "Сумма", width: "20%", align: "right" },
    ],
    rows: data.items.map((i) => [i.date, i.category, i.description, String(i.amount)]),
    headerTextColor: REPORT_COLORS.muted,
    borderColor: REPORT_COLORS.line,
    fontSize: 13,
  });

  const doc = b.add("Document", { title: "Отчёт о расходах" }, [page]);
  return b.build(doc);
}

export function buildMeetingMinutesSpec(data: MeetingMinutesData): ReportSpec {
  const b = new SpecBuilder();
  const page = b.add("Page", { size: "A4", ...PAGE_MARGINS });

  b.add("Heading", { text: data.title, level: "h1", color: REPORT_COLORS.accent });
  b.add("Text", { text: `Дата: ${data.date}`, color: REPORT_COLORS.muted, fontSize: 13 });
  b.add("Spacer", { height: 16 });

  section(b, "Участники");
  b.add("List", {
    items: data.attendees,
    ordered: false,
    fontSize: 13,
    spacing: 6,
    color: REPORT_COLORS.ink,
  });
  b.add("Spacer", { height: 8 });

  section(b, "Повестка");
  b.add("List", {
    items: data.agenda,
    ordered: true,
    fontSize: 13,
    spacing: 6,
    color: REPORT_COLORS.ink,
  });
  b.add("Spacer", { height: 8 });

  section(b, "Решения");
  for (const decision of data.decisions) {
    b.add("Text", { text: decision.text, fontSize: 13, color: REPORT_COLORS.ink });
    b.add("Text", {
      text: `Ответственный: ${decision.owner}`,
      fontSize: 12,
      color: REPORT_COLORS.muted,
    });
    b.add("Spacer", { height: 8 });
  }

  const doc = b.add("Document", { title: data.title }, [page]);
  return b.build(doc);
}

/** Pick the spec builder by report type (data validated by report-schemas beforehand). */
export function buildReportSpec(type: ReportType, data: Record<string, unknown>): ReportSpec {
  switch (type) {
    case "sales-report":
      return buildSalesReportSpec(data as SalesReportData);
    case "expense-report":
      return buildExpenseReportSpec(data as ExpenseReportData);
    case "meeting-minutes":
      return buildMeetingMinutesSpec(data as MeetingMinutesData);
  }
}
