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
  private parentId: string | null = null;

  add(type: string, props?: Record<string, unknown>, children: string[] = []): string {
    const id = `el-${++this.n}`;
    this.elements[id] = props ? { type, props, children } : { type, children };
    if (this.parentId !== null) {
      this.elements[this.parentId].children.push(id);
    }
    return id;
  }

  /** Subsequent add() calls are appended as children of this node. */
  setParent(id: string | null): void {
    this.parentId = id;
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
  b.setParent(page);

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

  b.setParent(null);
  const doc = b.add("Document", { title: "Отчёт о продажах" }, [page]);
  return b.build(doc);
}

export function buildExpenseReportSpec(data: ExpenseReportData): ReportSpec {
  const b = new SpecBuilder();
  const page = b.add("Page", { size: "A4", ...PAGE_MARGINS });
  b.setParent(page);

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

  b.setParent(null);
  const doc = b.add("Document", { title: "Отчёт о расходах" }, [page]);
  return b.build(doc);
}

export function buildMeetingMinutesSpec(data: MeetingMinutesData): ReportSpec {
  const b = new SpecBuilder();
  const page = b.add("Page", { size: "A4", ...PAGE_MARGINS });
  b.setParent(page);

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

  b.setParent(null);
  const doc = b.add("Document", { title: data.title }, [page]);
  return b.build(doc);
}

/** Pick the spec builder by report type (data validated by report-schemas beforehand). */
export function buildReportSpec(type: ReportType, data: Record<string, unknown>): ReportSpec {
  switch (type) {
    case "sales-report":
      return buildSalesReportSpec(data as SalesReportData);
    case "expense-report":
      return buildExpenseReportSpec(normalizeExpenseData(data));
    case "meeting-minutes":
      return buildMeetingMinutesSpec(data as MeetingMinutesData);
  }
}

/** Извлечь число из денежной метки "1 234,56 ₽" (для legacy-адаптера). */
function parseMoneyLabel(label: string): number {
  if (!label) return 0;
  const cleaned = label.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = Number.parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}

/**
 * R6: rich ExpenseReportInput → legacy ExpenseReportData (обратная совместимость
 * legacy-рендера). Если данные уже старые (period/totalAmount/categories/items),
 * возвращаются как есть.
 */
function normalizeExpenseData(data: Record<string, unknown>): ExpenseReportData {
  const isRich =
    (typeof data.summary === "object" && data.summary !== null) ||
    Array.isArray(data.suppliers) ||
    Array.isArray(data.receipts);
  if (!isRich) return data as ExpenseReportData;

  const summary = (data.summary ?? {}) as { totalLabel?: string };
  const suppliers = Array.isArray(data.suppliers)
    ? (data.suppliers as Array<{ supplier: string; totalLabel: string }>)
    : [];
  const receipts = Array.isArray(data.receipts)
    ? (data.receipts as Array<{ title: string; meta: string; items: Array<{ name: string; amountLabel: string }> }>)
    : [];

  return {
    period:
      typeof data.periodLabel === "string"
        ? data.periodLabel
        : typeof data.period === "string"
          ? data.period
          : "",
    totalAmount: parseMoneyLabel(summary.totalLabel ?? ""),
    categories: suppliers.map((s) => ({ name: s.supplier, amount: parseMoneyLabel(s.totalLabel) })),
    items: receipts.flatMap((r) =>
      (r.items ?? []).map((it) => ({
        date: r.meta ?? "",
        category: r.title ?? "",
        description: it.name,
        amount: parseMoneyLabel(it.amountLabel),
      })),
    ),
  };
}
