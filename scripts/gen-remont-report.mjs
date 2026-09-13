// Генерирует PDF-отчёт по расходам группы «ремонт» (-5400215325)
// напрямую из finance.sqlite (авторитетные суммы), рендер через @react-pdf.
import Database from "better-sqlite3";
import { renderExpensePdfRussian } from "../apps/agent/src/utils/reports/russian-pdf.ts";

const CHAT_ID = "-5400215325";
const TITLE = "ремонт";

const db = new Database("/home/admingimolost/.grish-ai/finance.sqlite", {
  readonly: true,
});

const rows = db
  .prepare(
    `SELECT date, vendor AS supplier, amount AS total, currency,
            category, COALESCE(category,'') AS catText
     FROM expenses WHERE chat_id = ?
     ORDER BY date ASC, created_at ASC`,
  )
  .all(CHAT_ID);

db.close();

if (rows.length === 0) {
  console.error("Нет расходов для", CHAT_ID);
  process.exit(1);
}

const pdfRows = rows.map((r) => ({
  date: r.date,
  supplier: r.supplier || "—",
  total: r.total,
  currency: r.currency || "RUB",
  category: r.category || null,
  needsReview: false,
}));

const totalAmount = pdfRows.reduce((a, r) => a + (r.total ?? 0), 0);

const filePath = await renderExpensePdfRussian({
  chatTitle: TITLE,
  periodLabel: "весь период",
  dimension: "none",
  sections: [{ label: "Все записи", rows: pdfRows, subtotal: totalAmount }],
  rows: pdfRows,
  totalAmount,
  currency: "RUB",
});

console.log("OK", filePath);
console.log("rows", pdfRows.length, "total", totalAmount.toFixed(2));
