/**
 * E3: канонический источник данных PDF-отчёта по расходам.
 *
 * Данные строятся из ФАКТА БД (`expense_documents`, тот же источник, что у
 * текстового эталона `expenses_sum`), а не из «пустого объекта LLM».
 * Никакого хардкода названий групп/чат-айди: scope — chatId/threadId из
 * контекста сессии.
 */
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ExpenseReportData } from "../../utils/reports/report-schemas.js";
import type {
  ExpenseLineItem,
  ExpenseReceiptBlock,
  ExpenseReportInput,
  ExpenseSupplierRow,
} from "@griha/render-tools";

export interface ExpenseReportSourceInput {
  /** Чат, по которому строится отчёт (обычно из контекста сессии). */
  chatId?: string;
  /** Тема форума (scope=thread); отсутствует → весь чат. */
  threadId?: string;
  /** Метка периода для заголовка/подписи (например, «весь период»). */
  period?: string;
  fromDate?: string;
  toDate?: string;
}

export type ExpenseReportBuildResult =
  | { ok: true; data: ExpenseReportData; periodLabel: string }
  | { ok: false; error: string };

export const EXPENSE_REPORT_EMPTY_MESSAGE = "Нет данных для PDF-отчёта.";

/** Скрыть позицию/сумму: null, <=0 или ИНН-like (мусор OCR). */
function isBadItemSum(sum: number | null | undefined): boolean {
  if (sum == null) return true;
  if (!Number.isFinite(sum) || sum <= 0) return true;
  return /^\d{10,12}$/.test(String(sum));
}

/** Category: пустой или слишком длинный → «без категории». */
function cleanCategory(supplier: string | null | undefined): string {
  const s = supplier?.trim();
  if (!s || s.length > 60) return "без категории";
  return s;
}

/** E3: построить данные expense-отчёта из БД (items + категории + итог). */
export async function buildExpenseReportData(
  repo: DocumentsRepository,
  input: ExpenseReportSourceInput,
): Promise<ExpenseReportBuildResult> {
  const chatId = input.chatId?.trim();
  if (!chatId) {
    return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };
  }

  const result = await repo.query({
    chatId,
    threadId: input.threadId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    limit: 200,
  });
  if (result.count === 0) {
    return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };
  }

  // needsReview-чеки НЕ смешиваем с успешными строками — отдельная секция.
  const clean = result.documents.filter((d) => !d.needsReview);
  const reviewCount = result.documents.length - clean.length;

  const items = clean
    .filter((d) => !isBadItemSum(d.total))
    .map((d) => ({
      date: d.docDate,
      category: cleanCategory(d.supplier),
      description: d.fileName ?? "",
      amount: d.total ?? 0,
    }));

  const bySupplier = new Map<string, number>();
  for (const d of clean) {
    const key = cleanCategory(d.supplier);
    bySupplier.set(key, (bySupplier.get(key) ?? 0) + (d.total ?? 0));
  }
  const categories = [...bySupplier.entries()].map(([name, amount]) => ({
    name,
    amount,
  }));

  const periodLabel =
    input.period && input.period.trim() ? input.period : "весь период";

  return {
    ok: true,
    periodLabel,
    data: {
      period: periodLabel,
      totalAmount: result.totalSum,
      categories,
      items,
      needsReviewCount: reviewCount,
    },
  };
}

// ── R6: rich-вход ExpenseReportInput (agent → package, без дублирования layout) ──

function fmtMoney(n: number, currency: string): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export interface ExpenseReportInputOptions {
  /** Title группы из setup (ChatSetupService.getChatTitleSync). */
  getChatTitle?: (chatId: string) => string | undefined;
}

export type ExpenseReportInputResult =
  | { ok: true; data: ExpenseReportInput; periodLabel: string }
  | { ok: false; error: string };

/**
 * R6: mapper expenses DB → ExpenseReportInput (rich). Группа-title, агрегат
 * поставщиков, развёртка чеков с позициями (itemsJson → items; нет items →
 * одна позиция = total чека). Пустая БД → error (guard E2 не трогаем).
 */
export async function buildExpenseReportInput(
  repo: DocumentsRepository,
  input: ExpenseReportSourceInput,
  opts: ExpenseReportInputOptions = {},
): Promise<ExpenseReportInputResult> {
  const chatId = input.chatId?.trim();
  if (!chatId) return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };

  const result = await repo.query({
    chatId,
    threadId: input.threadId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    limit: 200,
  });
  if (result.count === 0) return { ok: false, error: EXPENSE_REPORT_EMPTY_MESSAGE };

  const currency = result.currency === "RUB" ? "₽" : result.currency;

  // needsReview-чеки НЕ смешиваем с успешными строками — отдельная секция.
  const clean = result.documents.filter((d) => !d.needsReview);
  const reviewCount = result.documents.length - clean.length;

  // Поставщики: агрегат по supplier (category очищается от мусора/длины).
  const bySupplier = new Map<string, { count: number; total: number }>();
  for (const d of clean) {
    const key = cleanCategory(d.supplier);
    const cur = bySupplier.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += d.total ?? 0;
    bySupplier.set(key, cur);
  }
  const suppliers: ExpenseSupplierRow[] = [...bySupplier.entries()].map(([supplier, v]) => ({
    supplier,
    receiptCount: v.count,
    totalLabel: fmtMoney(v.total, currency),
  }));

  // Чеки: items из itemsJson; нет валидных items → одна позиция = total чека.
  const receipts: ExpenseReceiptBlock[] = clean.map((d, idx) => {
    let lineItems: ExpenseLineItem[] = [];
    if (d.items && d.items.length > 0) {
      lineItems = d.items
        .filter((it) => !isBadItemSum(it.sum))
        .map((it) => ({
          name: it.name,
          qtyLabel: it.qty !== undefined ? String(it.qty) : "1",
          amountLabel: fmtMoney(it.sum ?? 0, currency),
        }));
    }
    if (lineItems.length === 0) {
      lineItems = [
        {
          name: d.fileName || cleanCategory(d.supplier) || "чек",
          qtyLabel: "1",
          amountLabel: fmtMoney(d.total ?? 0, currency),
        },
      ];
    }
    return {
      title: `Чек №${idx + 1} · ${cleanCategory(d.supplier)}`,
      meta: `${d.docDate}${d.fileName ? ` · файл: ${d.fileName}` : ""}`,
      totalLabel: fmtMoney(d.total ?? 0, currency),
      items: lineItems,
    };
  });

  const lineItems = clean.reduce((acc, d) => {
    const valid = d.items ? d.items.filter((it) => !isBadItemSum(it.sum)).length : 0;
    return acc + (valid > 0 ? valid : 1);
  }, 0);
  const periodLabel = input.period && input.period.trim() ? input.period : "весь период";

  // Title группы — best-effort (метаданные, не должны ронять отчёт).
  let groupTitle = "";
  if (opts.getChatTitle) {
    try {
      groupTitle = opts.getChatTitle(chatId) ?? "";
    } catch {
      groupTitle = "";
    }
  }

  return {
    ok: true,
    periodLabel,
    data: {
      groupTitle,
      periodLabel,
      generatedAtLabel: new Date().toISOString().slice(0, 10),
      summary: {
        documents: result.documents.length,
        suppliers: suppliers.length,
        lineItems,
        totalLabel: fmtMoney(result.totalSum, currency),
      },
      suppliers,
      receipts,
      currency,
    },
  };
}
