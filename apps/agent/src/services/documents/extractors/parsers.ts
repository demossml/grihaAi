/**
 * Чистые парсеры caption-текста (StubExtractor, MVP без vision) + date helpers.
 */
import type { DocumentKind } from "../types.js";

export function todayYmd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function ymdDaysAgo(days: number, from = new Date()): string {
  const x = new Date(from);
  x.setUTCDate(x.getUTCDate() - days);
  return todayYmd(x);
}

/** "7d"|"14d"|"30d"|"month" → { fromDate, toDate } (включая toDate). */
export function resolvePeriod(period: string): { fromDate: string; toDate: string } {
  const toDate = todayYmd();
  if (period === "7d") return { fromDate: ymdDaysAgo(7), toDate };
  if (period === "14d") return { fromDate: ymdDaysAgo(14), toDate };
  if (period === "30d" || period === "month") return { fromDate: ymdDaysAgo(30), toDate };
  throw new Error(`unknown period ${period}`);
}

/** Нормализация «1 500,50» / «1.500,50» → 1500.5 (число), иначе undefined. */
function parseNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Сумма из текста: «15400 ₽», «итого 1 500,50 руб», «сумма: 15400». */
export function parseTotalFromText(text: string): number | undefined {
  if (!text) return undefined;
  // «итого/сумма/оплачено ... 12345.67 руб»
  const labeled =
    /(?:итого|сумма|оплачено|total|sum)\D{0,12}(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|rub|р\.)?/i.exec(
      text,
    );
  if (labeled) return parseNumber(labeled[1]);
  // просто число + валюта
  const money = /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|rub|rur|р\.)/i.exec(text);
  if (money) return parseNumber(money[1]);
  return undefined;
}

/** Дата из текста: dd.mm.yyyy | dd/mm/yyyy | yyyy-mm-dd → YYYY-MM-DD. */
export function parseDateFromText(text: string): string | undefined {
  if (!text) return undefined;
  const dm = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  if (dm) {
    const [, d, m, y] = dm;
    const year = y.length === 2 ? `20${y}` : y;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${year}-${mm}-${dd}`;
    }
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return iso[0];
  return undefined;
}

/**
 * Поставщик из текста: «чек из Ромашки», «накладная от ООО Ромашка».
 * Возвращает undefined, если паттерн не найден (честный needsReview).
 */
export function parseSupplierFromText(text: string): string | undefined {
  if (!text) return undefined;
  const m =
    /(?:чек|накладн[а-яё]*|счёт|счет|invoice|receipt|waybill)\s+(?:из|от|с|по|from)\s*[:\-—]?\s*([А-Яа-яЁёA-Za-z0-9«»"' ]{2,40})/i.exec(
      text,
    );
  if (!m) return undefined;
  const raw = m[1].replace(/[«»"'.,!?]+$/g, "").trim();
  const stop = /(?:итого|сумма|оплачено|total|sum|\d)/i.exec(raw);
  const cleaned = stop ? raw.slice(0, stop.index).trim() : raw;
  return cleaned.length >= 2 ? cleaned : undefined;
}

/**
 * Тип документа по распознанному тексту: waybill/invoice/receipt/unknown.
 * Используется VisionExtractor'ом (после OCR).
 */
export function detectKind(text: string): DocumentKind {
  const t = text.toLowerCase();
  if (/(накладн|товарная|waybill|торг-?12)/i.test(t)) return "waybill";
  if (/(счёт|счет|invoice|инвойс)/i.test(t)) return "invoice";
  if (/(чек|касс|receipt|итого|оплачено|сдача)/i.test(t)) return "receipt";
  return "unknown";
}

export function formatExpensesSum(r: import("../types.js").ExpensesQueryResult): string {
  if (r.count === 0) return "Записей по заданным фильтрам нет.";
  const scope = r.fullHistory ? "вся история чата" : "выбранный период";
  const lines = r.documents.slice(0, 10).map(
    (d) =>
      `- ${d.docDate} | ${d.supplier ?? "?"} | ${d.total ?? "?"} ${d.currency}${d.needsReview ? " (проверка)" : ""}`,
  );
  return [
    `Охват: ${scope}`,
    `Документов: ${r.count}`,
    `Сумма: ${r.totalSum} ${r.currency}`,
    r.note ? `Note: ${r.note}` : "",
    "Примеры:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}
