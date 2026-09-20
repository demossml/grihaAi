/**
 * Общий spec-билдер для PDF-шаблонов. Перенесено 1:1 из
 * apps/agent/src/utils/reports/report-specs.ts (apps/agent НЕ изменяется).
 */

export interface SpecElement {
  type: string;
  props?: Record<string, unknown>;
  children: string[];
}

export interface Spec {
  root: string;
  elements: Record<string, SpecElement>;
}

export const REPORT_COLORS = {
  ink: "#1a1a1a",
  muted: "#555555",
  accent: "#1f3864",
  line: "#dddddd",
} as const;

const PAGE_MARGINS = { marginTop: 32, marginBottom: 32, marginLeft: 40, marginRight: 40 } as const;

export class SpecBuilder {
  private elements: Record<string, SpecElement> = {};
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

  setParent(id: string | null): void {
    this.parentId = id;
  }

  build(root: string): Spec {
    return { root, elements: this.elements };
  }
}

function section(b: SpecBuilder, title: string): void {
  b.add("Heading", { text: title, level: "h2", color: REPORT_COLORS.accent });
  b.add("Divider", { color: REPORT_COLORS.line, marginTop: 4, marginBottom: 8 });
}

export interface SalesReportPayload {
  period: string;
  totalRevenue: number;
  categories: Array<{ name: string; revenue: number }>;
  topDeals: Array<{ title: string; amount: number }>;
}

export interface ExpenseReportPayload {
  period: string;
  totalAmount: number;
  categories: Array<{ name: string; amount: number }>;
  items: Array<{ date: string; category: string; description: string; amount: number }>;
}

export interface MeetingMinutesPayload {
  title: string;
  date: string;
  attendees: string[];
  agenda: string[];
  decisions: Array<{ text: string; owner: string }>;
}

export function buildSalesReportSpec(data: SalesReportPayload): Spec {
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

export function buildExpenseReportSpec(data: ExpenseReportPayload): Spec {
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

export function buildMeetingMinutesSpec(data: MeetingMinutesPayload): Spec {
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
