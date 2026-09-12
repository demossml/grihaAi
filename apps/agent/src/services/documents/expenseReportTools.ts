/**
 * Гибкие расходы (F1–F7): отчёт по разрезам из БД, исправление категорий
 * с chat-scoped обучением, поиск по raw_text/line_items.
 *
 * Данные НИКОГДА не берутся из LLM-схемы: всё из repository. Итог = SUM.
 * Разрез — свободная строка (dimension), не enum доменов.
 */
import { renderExpensePdfRussian, type ExpensePdfSection } from "../../utils/reports/russian-pdf.js";
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseLineItem } from "./types.js";

// ── Дедуп запросов отчёта (10 минут, F§6) ──────────────────────────────────

const RECENT_REPORTS = new Map<string, number>();
const REPORT_DEDUPE_TTL_MS = 10 * 60 * 1000;

export function wasReportRecentlySent(key: string): boolean {
  const ts = RECENT_REPORTS.get(key);
  return ts !== undefined && Date.now() - ts < REPORT_DEDUPE_TTL_MS;
}

export function markReportSent(key: string): void {
  if (RECENT_REPORTS.size > 200) {
    const cutoff = Date.now() - REPORT_DEDUPE_TTL_MS;
    for (const [k, ts] of RECENT_REPORTS) {
      if (ts < cutoff) RECENT_REPORTS.delete(k);
    }
  }
  RECENT_REPORTS.set(key, Date.now());
}

// ── Отчёт ──────────────────────────────────────────────────────────────────

export interface ExpenseReportPdfArgs {
  chatId?: string;
  threadId?: string;
  fromDate?: string;
  toDate?: string;
  /** Разрез: "none" | "supplier" | "category" | "tag" | свободная строка (F5). */
  dimension?: string;
  /** Оставить только одно значение разреза (опционально). */
  filterValue?: string;
}

export interface ExpenseReportPdfContext {
  /** Текущий чат сессии (default). */
  chatId?: string;
  /** Actor user id (в dedupe-ключе). */
  userId?: string;
  /** Название группы для заголовка PDF (F7). */
  chatTitle?: string;
  canManage?: (userId: string) => Promise<boolean>;
}

export interface ExpenseReportAttachment {
  filePath: string;
  caption: string;
  dedupeKey: string;
  totalAmount: number;
  count: number;
}

interface ReportRow {
  date: string;
  supplier?: string;
  total?: number;
  currency: string;
  needsReview: boolean;
  category?: string | null;
  tags?: string[];
}

/** F5: группировка строк по свободному разрезу; unknown → ошибка с подсказкой. */
export function groupReportRows(
  rows: ReportRow[],
  dimension: string | undefined,
  filterValue: string | undefined,
): { sections: ExpensePdfSection[]; error?: string } {
  if (!dimension || dimension === "none") {
    const filtered = filterValue
      ? rows.filter((r) => (r.supplier ?? "").toLowerCase() === filterValue.toLowerCase())
      : rows;
    const subtotal = filtered.reduce((a, r) => a + (r.total ?? 0), 0);
    return { sections: [{ label: "Все записи", rows: filtered, subtotal }] };
  }
  const known = ["supplier", "category", "tag"];
  if (!known.includes(dimension)) {
    return {
      sections: [],
      error: `Неизвестный разрез «${dimension}» (доступны: supplier, category, tag).`,
    };
  }
  const keyOf = (r: ReportRow): string => {
    if (dimension === "supplier") return r.supplier?.trim() || "—";
    if (dimension === "category") return r.category?.trim() || "прочее";
    return (r.tags ?? []).join(", ") || "—";
  };
  const buckets = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (filterValue && k.toLowerCase() !== filterValue.toLowerCase()) continue;
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  const sections = [...buckets.entries()]
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .map(([label, rs]) => ({ label, rows: rs, subtotal: sum(rs) }));
  return { sections };
}

function sum(rows: Array<{ total?: number }>): number {
  return rows.reduce((a, r) => a + (r.total ?? 0), 0);
}

export async function buildExpenseReportAttachment(
  args: ExpenseReportPdfArgs,
  ctx: ExpenseReportPdfContext,
  repo: DocumentsRepository,
): Promise<{ error: string } | ExpenseReportAttachment> {
  const current = ctx.chatId;
  const requested = args.chatId;
  if (requested && current && requested !== current) {
    const actor = ctx.userId ?? "";
    const allowed = ctx.canManage ? await ctx.canManage(actor) : false;
    if (!allowed) return { error: "Недостаточно прав для отчёта по чужому чату." };
  }
  const chatId = requested ?? current;
  if (!chatId) return { error: "Укажите chatId (текущий чат не определён)." };

  // R4: «весь период» = без дат → лимит покрывает все записи.
  const result = await repo.query({
    chatId,
    threadId: args.threadId,
    fromDate: args.fromDate,
    toDate: args.toDate,
    limit: 10_000,
  });

  const rows: ReportRow[] = result.documents.map((d) => ({
    date: d.docDate,
    supplier: d.supplier,
    total: d.total,
    currency: d.currency,
    needsReview: d.needsReview,
    category: d.category,
  }));
  const totalAmount = rows.reduce((acc, r) => acc + (r.total ?? 0), 0);
  const grouped = groupReportRows(rows, args.dimension, args.filterValue);
  if (grouped.error) return { error: grouped.error };
  const shown = grouped.sections.flatMap((s) => s.rows);
  const shownTotal = sum(shown);

  const periodLabel =
    !args.fromDate && !args.toDate
      ? "весь период"
      : `${args.fromDate ?? "…"} — ${args.toDate ?? "…"}`;

  const filePath = await renderExpensePdfRussian({
    chatTitle: ctx.chatTitle?.trim() || `Чат ${chatId}`,
    periodLabel,
    dimension: args.dimension,
    sections: grouped.sections,
    rows: shown,
    totalAmount: shownTotal,
    currency: result.currency,
  });

  const dedupeKey = `expense-pdf:${ctx.userId ?? "anon"}:${chatId}:${args.dimension ?? "none"}:${args.filterValue ?? ""}:${args.fromDate ?? ""}:${args.toDate ?? ""}:${shownTotal.toFixed(2)}:${shown.length}`;
  return {
    filePath,
    caption: `Отчёт по расходам за ${periodLabel}`,
    dedupeKey,
    totalAmount: shownTotal,
    count: shown.length,
  };
}

// ── F4: исправление категории + обучение ───────────────────────────────────

export interface ExpenseUpdateArgs {
  expenseId?: string;
  chatId?: string;
  category?: string;
  addTags?: string[];
  note?: string;
}

export interface ExpenseUpdateContext {
  chatId?: string;
  canManage?: (userId: string) => Promise<boolean>;
}

export async function expenseUpdateHandler(
  args: ExpenseUpdateArgs,
  ctx: ExpenseUpdateContext,
  repo: DocumentsRepository,
): Promise<string> {
  const chatId = args.chatId ?? ctx.chatId;
  if (!chatId) return "Укажите chatId (текущий чат не определён).";
  if (!args.category && !(args.addTags?.length)) return "Укажите category или addTags.";

  const target = args.expenseId
    ? await repo.getById(args.expenseId)
    : await repo.findLatestByChat(chatId);
  if (!target) return "Расход не найден — уточните expenseId.";

  const updated = await repo.updateExpenseCategory(target.id, {
    category: args.category !== undefined ? args.category : null,
    addTags: args.addTags,
  });
  if (!updated) return "Не удалось обновить расход.";

  // F4: запомнить в рамках чата — supplier → category (и keyword из note).
  if (args.category?.trim()) {
    if (updated.supplier?.trim()) {
      repo.upsertExpenseLearning({
        chatId,
        patternType: "supplier",
        pattern: updated.supplier.trim(),
        category: args.category.trim(),
      });
    }
    const kw = keywordFromNote(args.note);
    if (kw) {
      repo.upsertExpenseLearning({
        chatId,
        patternType: "keyword",
        pattern: kw,
        category: args.category.trim(),
      });
    }
  }

  return `Перенёс в «${args.category?.trim() ?? "без категории"}». Запомнил для похожих чеков в этой группе.`;
}

/** Короткое ключевое слово из примечания пользователя (для keyword-правила). */
export function keywordFromNote(note?: string): string | undefined {
  if (!note) return undefined;
  const m = /(?:по слову|по тексту|содержит|слово)\s*[:=]?\s*«?([^».]{2,30})»?/i.exec(note);
  if (m) return m[1].trim().toLowerCase();
  return undefined;
}

// ── F6: гибкий поиск («сколько метров кабеля») ────────────────────────────

export interface ExpenseSearchArgs {
  chatId?: string;
  query: string;
  fromDate?: string;
  toDate?: string;
}

export async function expensesSearchHandler(
  args: ExpenseSearchArgs,
  ctx: { chatId?: string },
  repo: DocumentsRepository,
): Promise<string> {
  const chatId = args.chatId ?? ctx.chatId;
  if (!chatId) return "Укажите chatId (текущий чат не определён).";
  if (!args.query?.trim()) return "Укажите query (что ищем).";

  const rows = await repo.searchExpenses({
    chatId,
    query: args.query,
    fromDate: args.fromDate,
    toDate: args.toDate,
    limit: 20,
  });
  if (rows.length === 0) return "По запросу ничего не найдено.";

  // Агрегация позиций: qty по unit (м/шт/кг…) для совпавших имён.
  const qtyByUnit = new Map<string, number>();
  let structuredLines = 0;
  const lines: string[] = [];
  for (const r of rows) {
    const snippet = (r.rawText ?? "").replace(/\s+/g, " ").slice(0, 120);
    lines.push(
      `- ${r.docDate} | ${r.supplier ?? "?"} | ${r.total ?? "?"} ${r.currency}${r.category ? ` | ${r.category}` : ""}${snippet ? ` | «${snippet}»` : ""}`,
    );
    for (const item of r.lineItems ?? []) {
      if (item.name && item.qty !== undefined && item.unit) {
        structuredLines++;
        qtyByUnit.set(item.unit, (qtyByUnit.get(item.unit) ?? 0) + item.qty);
      }
    }
  }
  const qtySummary = [...qtyByUnit.entries()]
    .map(([unit, q]) => `${q} ${unit}`)
    .join(", ");

  const totals = rows.reduce((a, r) => a + (r.total ?? 0), 0);
  return [
    `Найдено записей: ${rows.length}, сумма: ${totals} ${rows[0]?.currency ?? "RUB"}`,
    qtySummary ? `Количество по позициям: ${qtySummary}` : "",
    structuredLines === 0
      ? "Позиции в чеках не структурированы — вот фрагменты:"
      : "Фрагменты:",
    ...lines.slice(0, 20),
  ]
    .filter(Boolean)
    .join("\n");
}

// ── F6: агрегация qty line_items (для тестов и UI) ─────────────────────────

export function sumLineItemQty(
  items: Array<ExpenseLineItem | undefined | null> | undefined,
  nameNeedle: string,
  unit?: string,
): number {
  let total = 0;
  for (const item of items ?? []) {
    if (!item) continue;
    const nameMatch =
      !nameNeedle || item.name.toLowerCase().includes(nameNeedle.toLowerCase());
    const unitMatch = !unit || item.unit === unit;
    if (nameMatch && unitMatch && item.qty !== undefined) total += item.qty;
  }
  return total;
}
