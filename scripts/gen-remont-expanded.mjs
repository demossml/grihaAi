// Быстрый развёрнутый PDF-отчёт по расходам группы «ремонт» (-5400215325).
// Читает данные ИЗ БД (finance.sqlite + documents.sqlite), не парсит чеки заново.
// Позиции берутся из expense_documents.line_items (category = материалы/услуги/оборудование).
import { renderToFile, Document, Page, Text, View, Font } from "@react-pdf/renderer";
import { createElement as h, Fragment } from "react";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const CHAT_ID = process.env.REMONT_CHAT_ID || "-5400215325";
const FONT = process.env.AGENT_RUSSIAN_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

Font.register({ family: "DejaVu", src: FONT });
Font.registerHyphenationCallback((w) => [w]);

// ── Читаем из БД ──────────────────────────────────────────────────────────
const docsDb = new Database("/home/admingimolost/.grish-ai/documents.sqlite", { readonly: true });
const finDb = new Database("/home/admingimolost/.grish-ai/finance.sqlite", { readonly: true });

// Документы с разобранными позициями (line_items).
const docRows = docsDb
  .prepare(
    `SELECT id, doc_date, supplier, total, currency, line_items
     FROM expense_documents
     WHERE chat_id = ? AND line_items IS NOT NULL
     ORDER BY doc_date ASC, created_at ASC`,
  )
  .all(CHAT_ID);

// Расходы без позиций (напр. услуги, внесённые текстом) — из finance.expenses.
const finRows = finDb
  .prepare(
    `SELECT id, date, vendor, amount, currency, category
     FROM expenses WHERE chat_id = ? ORDER BY date ASC, created_at ASC`,
  )
  .all(CHAT_ID);

docsDb.close();
finDb.close();

// ── Сборка check-блоков ───────────────────────────────────────────────────
const checks = [];

for (const d of docRows) {
  let items = [];
  try {
    items = JSON.parse(d.line_items || "[]");
  } catch {
    items = [];
  }
  if (items.length === 0) continue;
  checks.push({
    supplier: d.supplier || "Без названия",
    date: fmtDate(d.doc_date),
    total: d.total,
    items: items.map((it) => [it.name || "?", normalizeAmt(it.amount), it.category || "материалы"]),
  });
}

// Расходы из finance без line_items → отдельными блоками-строками.
// Dedup по сумме (а не по дате): в finance дата = дата внесения, а не дата чека.
const docAmounts = new Set(checks.map((c) => (c.total ?? 0).toFixed(2)));
for (const f of finRows) {
  if (docAmounts.has((f.amount ?? 0).toFixed(2))) continue;
  checks.push({
    supplier: f.vendor || "Услуги",
    date: fmtDate(f.date),
    total: f.amount,
    items: [[f.vendor || "Услуги", f.amount, normPurpose(f.category)]],
  });
}

checks.sort((a, b) => a.date.localeCompare(b.date));

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}
function normalizeAmt(a) {
  const v = typeof a === "number" ? a : Number(a) || 0;
  return v;
}
function normPurpose(c) {
  if (!c) return "материалы";
  const s = c.toLowerCase();
  if (s.includes("услуг")) return "услуги";
  if (s.includes("оборуд")) return "оборудование";
  return "материалы";
}

// ── Агрегация по назначению ───────────────────────────────────────────────
const PURPOSE_LABEL = {
  материалы: "Закупка материала",
  услуги: "Услуги",
  оборудование: "Закупка оборудования",
};
const purposeTotals = { материалы: 0, услуги: 0, оборудование: 0 };
let grandTotal = 0;
for (const c of checks) {
  c.total ??= c.items.reduce((a, [, amt]) => a + amt, 0);
  for (const [, amt, purpose] of c.items) {
    const p = purpose === "услуги" ? "услуги" : purpose === "оборудование" ? "оборудование" : "материалы";
    purposeTotals[p] += amt;
    grandTotal += amt;
  }
}

const money = (n) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ── Стили ─────────────────────────────────────────────────────────────────
const DARK = "#1F3864";
const GREEN = "#2E9E5B";
const ROW_ALT = "#EEF2F8";
const s = {
  page: { padding: 40, fontFamily: "DejaVu", fontSize: 9, color: "#1a1a1a" },
  title: { fontSize: 20, fontWeight: "bold", color: DARK, marginBottom: 2 },
  subtitle: { fontSize: 11, color: "#555555", marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: DARK, marginTop: 12, marginBottom: 4 },
  checkHeader: { fontSize: 11, fontWeight: "bold", color: "#000", marginTop: 8, marginBottom: 2 },
  row: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 4 },
  rowAlt: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 4, backgroundColor: ROW_ALT },
  colItem: { flex: 5 },
  colAmt: { flex: 1.6, textAlign: "right" },
  checkTotal: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingVertical: 3, paddingHorizontal: 4, backgroundColor: "#E8EDF5", fontWeight: "bold" },
  purposeRow: { flexDirection: "row", marginBottom: 4, fontSize: 10 },
  totalBox: { marginTop: 14, backgroundColor: GREEN, color: "#fff", padding: 8, fontSize: 11, fontWeight: "bold", flexDirection: "row", justifyContent: "space-between" },
};

function CheckView({ check, idx }) {
  const rows = check.items.map(([name, amt], i) =>
    h(View, { key: i, style: i % 2 === 0 ? s.row : s.rowAlt, wrap: false },
      h(Text, { style: s.colItem }, name),
      h(Text, { style: s.colAmt }, `${money(amt)} ₽`),
    ),
  );
  return h(Fragment, null,
    h(View, { style: s.checkHeader, wrap: false },
      h(Text, null, `${idx}. ${check.supplier} — ${check.date}`),
    ),
    ...rows,
    h(View, { style: s.checkTotal, wrap: false },
      h(Text, null, "Итого по чеку"),
      h(Text, null, `${money(check.total)} ₽`),
    ),
  );
}

function App() {
  const purposeRows = ["материалы", "услуги", "оборудование"]
    .filter((p) => purposeTotals[p] > 0)
    .map((p) =>
      h(View, { key: p, style: s.purposeRow },
        h(Text, { style: s.colItem }, PURPOSE_LABEL[p]),
        h(Text, { style: s.colAmt }, `${money(purposeTotals[p])} ₽`),
      ),
    );
  return h(Document,
    { title: "Отчёт по расходам — группа «ремонт»", author: "griha-ai" },
    h(Page, { size: "A4", style: s.page },
      h(Text, { style: s.title }, "Отчёт по расходам — группа «ремонт»"),
      h(Text, { style: s.subtitle }, `Период: весь период · Валюта: RUB · Чеков: ${checks.length}`),
      ...checks.map((c, i) => h(CheckView, { key: i, check: c, idx: i + 1 })),
      h(View, { style: {}, wrap: false },
        h(Text, { style: s.sectionTitle }, "Разбивка по назначению"),
        ...purposeRows,
      ),
      h(View, { style: s.totalBox, wrap: false },
        h(Text, null, "ИТОГО (весь период)"),
        h(Text, null, `${money(grandTotal)} ₽`),
      ),
    ),
  );
}

const out = `/home/admingimolost/.grish-ai/reports/remont-report-${randomUUID()}.pdf`;
await renderToFile(h(App), out);
console.log("OK", out);
console.log("grandTotal", money(grandTotal), "checks", checks.length);
