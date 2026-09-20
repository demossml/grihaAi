import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderDocument } from "./render.js";
import { getRenderer, listTemplates } from "./templates/registry.js";

test("валидный expense-report → ok true, bytes > 5000, файл существует", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "render-tools-"));
  try {
    const result = await renderDocument(
      {
        format: "pdf",
        template: "expense-report",
        title: "Отчёт о расходах",
        blocks: [{ kind: "markdown", text: "запасной блок" }],
        data: {
          period: "Сентябрь 2026",
          totalAmount: 37561.5,
          categories: [{ name: "Магазин Электрик", amount: 37561.5 }],
          items: [
            { date: "2026-09-10", category: "Магазин Электрик", description: "провод", amount: 37561.5 },
          ],
        },
      },
      { outDir: dir },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.ok(result.bytes > 5000, `bytes=${result.bytes} должно быть > 5000 (встроенный шрифт/кириллица)`);
      assert.ok(existsSync(result.filePath), "файл должен существовать");
      const buf = readFileSync(result.filePath);
      assert.equal(buf.length, result.bytes);
      assert.ok(
        buf.includes("FontFile2") || buf.includes("ToUnicode") || buf.includes("Arial"),
        "должен быть встроенный шрифт или ToUnicode (кириллица)",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expense-report rich input (1 supplier + 1 receipt 2 items) → PDF > 8000 + кириллица", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "render-tools-"));
  try {
    const result = await renderDocument(
      {
        format: "pdf",
        template: "expense-report",
        title: "Отчёт по расходам",
        blocks: [{ kind: "markdown", text: "x" }],
        data: {
          groupTitle: "Ремонт",
          periodLabel: "Сентябрь 2026",
          generatedAtLabel: "2026-09-20",
          currency: "₽",
          summary: { documents: 1, suppliers: 1, lineItems: 2, totalLabel: "507,99 ₽" },
          suppliers: [{ supplier: "Магнит", receiptCount: 1, totalLabel: "507,99 ₽" }],
          receipts: [
            {
              title: "Чек №1 · Магнит",
              meta: "12.09.2026 · файл: receipt-1.jpg",
              totalLabel: "507,99 ₽",
              items: [
                { name: "Кабель ВВГ 3x2,5", qtyLabel: "45 м", amountLabel: "178,00 ₽" },
                { name: "Розетка", qtyLabel: "2 шт", amountLabel: "329,99 ₽" },
              ],
            },
          ],
        },
      },
      { outDir: dir },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.ok(result.bytes > 8000, `bytes=${result.bytes} должно быть > 8000`);
      const buf = readFileSync(result.filePath);
      assert.ok(
        buf.includes("FontFile2") || buf.includes("ToUnicode") || buf.includes("Arial"),
        "кириллица: встроенный шрифт",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expense-report пустые receipts[] → валидный PDF со сводкой", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "render-tools-"));
  try {
    const result = await renderDocument(
      {
        format: "pdf",
        template: "expense-report",
        title: "Отчёт по расходам",
        blocks: [{ kind: "markdown", text: "x" }],
        data: {
          groupTitle: "Ремонт",
          periodLabel: "Сентябрь 2026",
          generatedAtLabel: "2026-09-20",
          summary: { documents: 0, suppliers: 0, lineItems: 0, totalLabel: "0,00 ₽" },
          suppliers: [],
          receipts: [],
        },
      },
      { outDir: dir },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.ok(result.bytes > 5000, `bytes=${result.bytes}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid → ok false INVALID_INPUT", async () => {
  const result = await renderDocument(
    { format: "pdf", template: "expense-report", title: "", blocks: [] },
    { outDir: os.tmpdir() },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
});

const R4_FIXTURES: Array<{ template: string; data: Record<string, unknown> }> = [
  {
    template: "sales-report",
    data: {
      title: "Отчёт по продажам",
      periodLabel: "Сентябрь 2026",
      generatedAtLabel: "2026-09-20",
      summary: { orders: 2, units: 5, revenueLabel: "12 000,00 ₽" },
      rows: [
        { dateLabel: "01.09", product: "Кабель", qty: 3, amountLabel: "6 000,00 ₽" },
        { dateLabel: "02.09", product: "Розетка", qty: 2, amountLabel: "6 000,00 ₽" },
      ],
      totalLabel: "12 000,00 ₽",
    },
  },
  {
    template: "sellers-report",
    data: {
      periodLabel: "Сентябрь 2026",
      generatedAtLabel: "2026-09-20",
      rows: [
        { seller: "Иван", deals: 5, revenueLabel: "7 000,00 ₽", sharePercent: 58 },
        { seller: "Мария", deals: 3, revenueLabel: "5 000,00 ₽", sharePercent: 42 },
      ],
      totalLabel: "12 000,00 ₽",
    },
  },
  {
    template: "revenue-report",
    data: {
      periodLabel: "2026",
      generatedAtLabel: "2026-09-20",
      byMonth: [
        { monthLabel: "Январь", revenueLabel: "10 000,00 ₽" },
        { monthLabel: "Февраль", revenueLabel: "20 000,00 ₽" },
      ],
      totalLabel: "30 000,00 ₽",
    },
  },
  {
    template: "profit-report",
    data: {
      periodLabel: "Сентябрь 2026",
      generatedAtLabel: "2026-09-20",
      revenueLabel: "100 000,00 ₽",
      cogsLabel: "60 000,00 ₽",
      opexLabel: "20 000,00 ₽",
      profitLabel: "20 000,00 ₽",
      marginPercentLabel: "20%",
      rows: [
        { category: "Материалы", amountLabel: "60 000,00 ₽" },
        { category: "Аренда", amountLabel: "20 000,00 ₽" },
      ],
    },
  },
  {
    template: "generic-table-report",
    data: {
      title: "Произвольная таблица",
      subtitleLines: ["Период: Сентябрь 2026"],
      columns: [
        { key: "name", header: "Название", align: "left", width: "50%" },
        { key: "value", header: "Значение", align: "right", width: "50%" },
      ],
      rows: [
        { name: "А", value: "1" },
        { name: "Б", value: "2" },
      ],
      footerNote: "Примечание",
    },
  },
];

test("R4: все шаблоны рендерятся (bytes > 5000)", async () => {
  for (const fixture of R4_FIXTURES) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "render-tools-"));
    try {
      const result = await renderDocument(
        {
          format: "pdf",
          template: fixture.template as never,
          title: "Отчёт",
          blocks: [{ kind: "markdown", text: "x" }],
          data: fixture.data,
        },
        { outDir: dir },
      );
      assert.equal(result.ok, true, `${fixture.template}: ${JSON.stringify(result)}`);
      if (result.ok) {
        assert.ok(result.bytes > 5000, `${fixture.template}: bytes=${result.bytes}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("unknown template → UNKNOWN_TEMPLATE (registry miss)", async () => {
  // RenderTemplateSchema — enum из 3 имён, поэтому "unknown" отвергается
  // safeParse ещё раньше (INVALID_INPUT). Ветку UNKNOWN_TEMPLATE проверяем
  // напрямую через registry: неизвестное имя → getRenderer undefined.
  assert.equal(getRenderer("unknown"), undefined);
  assert.deepEqual([...listTemplates()].sort(), [
    "expense-report",
    "generic-table-report",
    "meeting-minutes",
    "profit-report",
    "revenue-report",
    "sales-report",
    "sellers-report",
  ]);

  // Через публичный renderDocument enum-схема отдаёт INVALID_INPUT для "unknown".
  const viaRender = await renderDocument(
    { format: "pdf", template: "unknown", title: "x", blocks: [{ kind: "markdown", text: "x" }] },
    { outDir: os.tmpdir() },
  );
  assert.equal(viaRender.ok, false);
});
