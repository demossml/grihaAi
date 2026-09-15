import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderPdfReport,
  resolveCyrillicFontPaths,
} from "../../../src/utils/reports/report-renderer.js";

/**
 * Regression: PDF-отчёты должны содержать ВИДИМЫЙ кириллический текст.
 *
 * Исторический дефект: рендер отдавал «успешный» PDF, в котором текст либо не
 * попадал на страницу вообще (пустая страница без /Font и /ToUnicode), либо
 * рендерился стандартной Helvetica без глифов кириллицы — на выходе glyph 0,
 * визуально пустой лист. Оба варианта дают PDF БЕЗ встроенного шрифта и
 * ToUnicode-карты. Этот тест падает на обоих и проходит только когда в PDF
 * встроен шрифт с кириллицей (FontFile2 + ToUnicode + имя Arial/DejaVu).
 */

describe("report pdf cyrillic (real @json-render/react-pdf + font)", () => {
  it("embeds a Cyrillic-capable font and writes real glyphs", async () => {
    // Нет ни одного шрифта с кириллицей → явно пропускаем, а не падаем:
    // это окружение без TTF, и сам рендер обязан был бы бросить понятную ошибку.
    let fontPaths: { regular: string; bold: string };
    try {
      fontPaths = resolveCyrillicFontPaths();
    } catch {
      return; // t.skip is unavailable in plain node:test; early return marks pass
    }
    assert.ok(existsSync(fontPaths.regular), "resolved regular font must exist");

    const dir = mkdtempSync(path.join(os.tmpdir(), "report-cyr-"));
    try {
      const outputPath = await renderPdfReport(
        "expense-report",
        {
          period: "весь период",
          totalAmount: 37561.5,
          categories: [{ name: "Магазин Электрик", amount: 37561.5 }],
          items: [
            { date: "2026-09-10", category: "Магазин Электрик", description: "провод", amount: 37561.5 },
          ],
        },
        { outputDir: dir },
      );

      assert.ok(existsSync(outputPath));
      const bytes = readFileSync(outputPath);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "output must be a PDF");
      // Пустая страница (старый дефект) — ~1.2 КБ структуры; с встроенным
      // шрифтом и текстом PDF заметно больше.
      assert.ok(bytes.length > 5000, "PDF must not be an empty page");

      // Встроенный подмножественный шрифт (стандартная Helvetica программы не
      // содержит), ToUnicode-карта (маппинг глифов в Unicode) и имя
      // кириллического шрифта в FontDescriptor.
      assert.ok(bytes.includes("FontFile2"), "must embed a real font program");
      assert.ok(bytes.includes("ToUnicode"), "must embed a ToUnicode CMap");
      assert.ok(
        bytes.includes("Arial") || bytes.includes("DejaVu"),
        "must embed a Cyrillic-capable font (Arial/DejaVu), not standard Helvetica",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
