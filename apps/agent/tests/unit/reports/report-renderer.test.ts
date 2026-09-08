import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderPdfReport,
  renderPresentation,
  type PresentationSlide,
} from "../../../src/utils/reports/report-renderer.js";
import {
  buildExpenseReportSpec,
  buildMeetingMinutesSpec,
  buildReportSpec,
  buildSalesReportSpec,
  REPORT_COLORS,
  type ReportSpec,
  type ReportSpecElement,
} from "../../../src/utils/reports/report-specs.js";

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "report-"));

/** All spec elements (id → element). */
const elements = (spec: ReportSpec): Record<string, ReportSpecElement> => spec.elements;

/** Find the first element whose type matches and whose props pass the predicate. */
function findByProps(
  spec: ReportSpec,
  type: string,
  predicate: (props: Record<string, unknown>) => boolean,
): ReportSpecElement | undefined {
  return Object.values(spec.elements).find((e) => e.type === type && e.props && predicate(e.props));
}

const textOf = (v: unknown): string => String(v);

describe("report spec builders (json-render tree, no rendering)", () => {
  it("sales-report spec: Document root, headings, totals, table and top deals", () => {
    const spec = buildSalesReportSpec({
      period: "Q1 2026",
      totalRevenue: 150000,
      categories: [
        { name: "Консалтинг", revenue: 100000 },
        { name: "Лицензии", revenue: 50000 },
      ],
      topDeals: [{ title: "Корпорация А", amount: 60000 }],
    });

    // Корень — Document, в детях — Page.
    assert.equal(elements(spec)[spec.root].type, "Document");
    assert.deepEqual(elements(spec)[spec.root].children.map((id) => elements(spec)[id].type), ["Page"]);

    // Заголовок и период.
    const h1 = findByProps(spec, "Heading", (p) => p.level === "h1");
    assert.ok(h1);
    assert.equal(textOf(h1!.props!.text), "Отчёт о продажах");
    assert.equal(h1!.props!.color, REPORT_COLORS.accent);
    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "Период: Q1 2026"));

    // Итоговая выручка крупным текстом.
    const total = findByProps(spec, "Text", (p) => textOf(p.text) === "150000");
    assert.ok(total);
    assert.equal(total!.props!.fontSize, 28);
    assert.equal(total!.props!.fontWeight, "bold");

    // Таблица категорий.
    const table = findByProps(spec, "Table", (p) => (p.columns as Array<{ header: string }>)[0].header === "Категория");
    assert.ok(table);
    const props = table!.props!;
    assert.deepEqual(props.columns, [
      { header: "Категория", width: "60%", align: "left" },
      { header: "Выручка", width: "40%", align: "right" },
    ]);
    assert.deepEqual(props.rows, [
      ["Консалтинг", "100000"],
      ["Лицензии", "50000"],
    ]);

    // Нумерованный список топ-сделок.
    const list = findByProps(spec, "List", (p) => p.ordered === true);
    assert.ok(list);
    assert.deepEqual(list!.props!.items, ["Корпорация А — 60000"]);
  });

  it("expense-report spec: period, total, categories table and items table", () => {
    const spec = buildExpenseReportSpec({
      period: "Сентябрь 2026",
      totalAmount: 1234,
      categories: [{ name: "Офис", amount: 1234 }],
      items: [{ date: "2026-09-01", category: "Офис", description: "Аренда", amount: 1234 }],
    });

    assert.equal(elements(spec)[spec.root].type, "Document");
    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "Период: Сентябрь 2026"));
    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "1234" && p.fontSize === 28));

    const categoriesTable = findByProps(spec, "Table", (p) => (p.columns as Array<{ header: string }>)[0].header === "Категория");
    assert.deepEqual(categoriesTable?.props?.rows, [["Офис", "1234"]]);

    const itemsTable = findByProps(spec, "Table", (p) => (p.columns as Array<{ header: string }>)[0].header === "Дата");
    assert.deepEqual((itemsTable?.props?.columns as Array<{ header: string }>).map((c) => c.header), [
      "Дата",
      "Категория",
      "Описание",
      "Сумма",
    ]);
    assert.deepEqual(itemsTable?.props?.rows, [["2026-09-01", "Офис", "Аренда", "1234"]]);
  });

  it("meeting-minutes spec: title, attendees, agenda, decisions with owners", () => {
    const spec = buildMeetingMinutesSpec({
      title: "Планёрка",
      date: "2026-09-08",
      attendees: ["Иван", "Мария"],
      agenda: ["Бюджет"],
      decisions: [{ text: "Утвердить бюджет", owner: "Иван" }],
    });

    const h1 = findByProps(spec, "Heading", (p) => p.level === "h1");
    assert.equal(textOf(h1!.props!.text), "Планёрка");
    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "Дата: 2026-09-08"));

    const attendees = findByProps(spec, "List", (p) => p.ordered === false);
    assert.deepEqual(attendees?.props?.items, ["Иван", "Мария"]);

    const agenda = findByProps(spec, "List", (p) => p.ordered === true);
    assert.deepEqual(agenda?.props?.items, ["Бюджет"]);

    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "Утвердить бюджет"));
    assert.ok(findByProps(spec, "Text", (p) => textOf(p.text) === "Ответственный: Иван"));
  });

  it("buildReportSpec routes by report type", () => {
    assert.equal(
      findByProps(buildReportSpec("sales-report", {
        period: "p",
        totalRevenue: 1,
        categories: [],
        topDeals: [],
      }), "Heading", (p) => p.level === "h1")?.props?.text,
      "Отчёт о продажах",
    );
    assert.equal(
      findByProps(buildReportSpec("expense-report", {
        period: "p",
        totalAmount: 1,
        categories: [],
        items: [],
      }), "Heading", (p) => p.level === "h1")?.props?.text,
      "Отчёт о расходах",
    );
    assert.equal(
      findByProps(buildReportSpec("meeting-minutes", {
        title: "T",
        date: "d",
        attendees: [],
        agenda: [],
        decisions: [],
      }), "Heading", (p) => p.level === "h1")?.props?.text,
      "T",
    );
  });
});

describe("report renderer — pdf/pptx DI", () => {
  it("renderPdfReport passes the built spec to the injected render fn", async () => {
    const dir = tmp();
    try {
      const captured: { spec: ReportSpec; out: string } = { spec: { root: "", elements: {} }, out: "" };
      const result = await renderPdfReport(
        "expense-report",
        {
          period: "Сентябрь",
          totalAmount: 1234,
          categories: [{ name: "Офис", amount: 1234 }],
          items: [{ date: "2026-09-01", category: "Офис", description: "Аренда", amount: 1234 }],
        },
        {
          outputDir: dir,
          pdfSpecRenderFn: async (spec, out) => {
            captured.spec = spec;
            captured.out = out;
          },
        },
      );

      assert.ok(result.endsWith(".pdf"));
      assert.equal(captured.out, result);
      assert.equal(captured.spec.elements[captured.spec.root].type, "Document");
      const hasArenada = Object.values(captured.spec.elements).some(
        (e) =>
          e.type === "Table" &&
          e.props &&
          (e.props.rows as string[][]).some((row) => row.includes("Аренда")),
      );
      assert.ok(hasArenada);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renderPresentation passes slides to the injected writer", async () => {
    const dir = tmp();
    try {
      const slides: PresentationSlide[] = [
        { title: "Заголовок", bullets: ["пункт 1", "пункт 2"] },
      ];
      let captured: PresentationSlide[] | null = null;
      const result = await renderPresentation(slides, {
        outputDir: dir,
        pptxWriteFn: async (s) => {
          captured = s;
        },
      });

      assert.ok(result.endsWith(".pptx"));
      assert.deepEqual(captured, slides);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
