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

test("invalid → ok false INVALID_INPUT", async () => {
  const result = await renderDocument(
    { format: "pdf", template: "expense-report", title: "", blocks: [] },
    { outDir: os.tmpdir() },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
});

test("unknown template → UNKNOWN_TEMPLATE (registry miss)", async () => {
  // RenderTemplateSchema — enum из 3 имён, поэтому "unknown" отвергается
  // safeParse ещё раньше (INVALID_INPUT). Ветку UNKNOWN_TEMPLATE проверяем
  // напрямую через registry: неизвестное имя → getRenderer undefined.
  assert.equal(getRenderer("unknown"), undefined);
  assert.deepEqual([...listTemplates()].sort(), ["expense-report", "meeting-minutes", "sales-report"]);

  // Через публичный renderDocument enum-схема отдаёт INVALID_INPUT для "unknown".
  const viaRender = await renderDocument(
    { format: "pdf", template: "unknown", title: "x", blocks: [{ kind: "markdown", text: "x" }] },
    { outDir: os.tmpdir() },
  );
  assert.equal(viaRender.ok, false);
});
