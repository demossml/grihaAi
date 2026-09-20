import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportShellSpec } from "./shell.js";
import { addReportTable } from "./table.js";
import { renderPdfBuffer } from "../pdf.js";

test("layout kit: shell + table → валидный PDF с кириллицей (> 5000 bytes)", async () => {
  const spec = buildReportShellSpec(
    {
      documentTitle: "Отчёт по расходам",
      subtitleLines: ["Группа: Ремонт", "Период: Сентябрь 2026", "Сформировано: 2026-09-20"],
      footerText: "Сформировано Гришей",
    },
    (b) => {
      b.add("Heading", { text: "1. Сводка", level: "h2", color: "#2b6cb0" });
      addReportTable(b, {
        columns: [
          { header: "Поставщик", align: "left", width: "60%" },
          { header: "Чеков", align: "center", width: "20%" },
          { header: "Сумма", align: "right", width: "20%" },
        ],
        rows: [
          ["Магнит", "2", "1 234,00 ₽"],
          ["Офис-сити", "1", "567,00 ₽"],
        ],
      });
    },
  );

  const buffer = await renderPdfBuffer(spec);
  assert.ok(buffer.length > 5000, `bytes=${buffer.length} должно быть > 5000`);
  assert.ok(
    buffer.includes("FontFile2") || buffer.includes("ToUnicode") || buffer.includes("Arial"),
    "должен быть встроенный шрифт/ToUnicode (кириллица)",
  );
});
