import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderHtml,
  renderPdfReport,
  renderPresentation,
  type PresentationSlide,
} from "../../src/utils/report-renderer.js";

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "report-"));

describe("report renderer — HTML (real Handlebars)", () => {
  it("renders sales-report with substituted data", async () => {
    const html = await renderHtml("sales-report", {
      period: "Q1 2026",
      totalRevenue: 150000,
      categories: [
        { name: "Консалтинг", revenue: 100000 },
        { name: "Лицензии", revenue: 50000 },
      ],
      topDeals: [{ title: "Корпорация А", amount: 60000 }],
    });

    assert.match(html, /Q1 2026/);
    assert.match(html, /150000/);
    assert.match(html, /Консалтинг/);
    assert.match(html, /100000/);
    assert.match(html, /Корпорация А/);
    assert.match(html, /60000/);
  });

  it("renders expense-report items table", async () => {
    const html = await renderHtml("expense-report", {
      period: "Сентябрь 2026",
      totalAmount: 1234,
      categories: [{ name: "Офис", amount: 1234 }],
      items: [{ date: "2026-09-01", category: "Офис", description: "Аренда", amount: 1234 }],
    });

    assert.match(html, /Сентябрь 2026/);
    assert.match(html, /Офис/);
    assert.match(html, /Аренда/);
  });

  it("renders meeting-minutes attendees and decisions", async () => {
    const html = await renderHtml("meeting-minutes", {
      title: "Планёрка",
      date: "2026-09-08",
      attendees: ["Иван", "Мария"],
      agenda: ["Бюджет"],
      decisions: [{ text: "Утвердить бюджет", owner: "Иван" }],
    });

    assert.match(html, /Планёрка/);
    assert.match(html, /Иван/);
    assert.match(html, /Мария/);
    assert.match(html, /Утвердить бюджет/);
    assert.match(html, /Ответственный: Иван/);
  });
});

describe("report renderer — pdf/pptx DI", () => {
  it("renderPdfReport passes html to the injected pdf fn and returns a path", async () => {
    const dir = tmp();
    try {
      const captured: { html: string; out: string } = { html: "", out: "" };
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
          pdfRenderFn: async (html, out) => {
            captured.html = html;
            captured.out = out;
          },
        },
      );

      assert.ok(result.endsWith(".pdf"));
      assert.match(captured.html, /Сентябрь/);
      assert.match(captured.html, /Аренда/);
      assert.equal(captured.out, result);
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
