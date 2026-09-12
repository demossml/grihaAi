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

/** Noise-строки: НДС/НАС/налог/скидк/процент/% — за суммы не берём (R1.1).
 *  Границы после кириллицы — lookahead, т.к. JS `\b` видит только ASCII `\w`. */
function isNoiseLine(line: string): boolean {
  return /(?:ндс|нас)(?=[\s\d%]|$)|налог|скидк|процент|%/i.test(line);
}

/**
 * Итог из чека (R1.1). Приоритет шагов фиксирован:
 *   1) строка «ИТОГ/ИТОГО/к оплате/…» с числом (не «Скидка на итог» — noise);
 *   2) OCR-обрезки «ОГ =2437» / «ТОГО» / «ИТ» на короткой строке с «=»;
 *   3) осторожный «сумма: N» на не-noise строке (не «СУММА НДС»);
 *   4) НАЛИЧНЫМИ/БЕЗНАЛИЧНЫМИ/оплачено — только если нет «СДАЧА <число>»;
 *   5) fallback: последнее число с валютой на не-noise строках.
 */
export function parseTotalFromText(text: string): number | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);

  // 1) Явная строка итога: «ИТОГО =20515.00», «ИТОГ 1234.56», «К ОПЛАТЕ: 1 234,56»,
  //    R1.2: «ИТОГО....................6767.00» — filler из точек/дефисов/пробелов/:=
  //    между маркером и числом (десятичная часть числа при этом цела).
  //    Граница после кириллического маркера — lookahead (\b не видит кириллицу).
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const m = /(?:итого|итог|всего\s+к\s+оплате|к\s+оплате|total\s+due|grand\s+total)(?=[\s.:=\-–—\d]|$)[\s.:=\-–—]*([\d][\d\s\u00a0]*(?:[.,]\d{1,2})?)/i.exec(
      line,
    );
    if (m) {
      const n = parseNumber(m[1]);
      if (n !== undefined) return n;
    }
  }

  // 2) OCR bare: «ОГ =2437», «ТОГО =…», «ИТ =…» — обрезки «ИТОГ».
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const m = /^(ог|того|ит)\s*[:=]\s*([\d][\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*$/i.exec(line.trim());
    if (m) {
      const n = parseNumber(m[2]);
      if (n !== undefined) return n;
    }
  }

  // 3) Осторожный «сумма: N» / «сумма=N» — не «СУММА НДС», не «ИТОГО ДО СКИДОК».
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const m = /сумма\s*[:=]\s*([\d][\d\s\u00a0]*(?:[.,]\d{1,2})?)/i.exec(line);
    if (m) {
      const n = parseNumber(m[1]);
      if (n !== undefined) return n;
    }
  }

  // 4) Фактическая оплата — только если в чеке нет «СДАЧА <число>»
  //    (внесённая сумма > итога, наличные ≠ total).
  if (!/сдача\s*[:=]?\s*[\d]/i.test(text)) {
    const paid = /(?:наличными|безналичными|оплачено)\s*[:=]?\s*([\d][\d\s\u00a0]*(?:[.,]\d{1,2})?)/i.exec(
      text,
    );
    if (paid) {
      const n = parseNumber(paid[1]);
      if (n !== undefined) return n;
    }
  }

  // 5) Fallback: последнее число с валютой на не-noise строках (обычно итог).
  const cleaned = lines.filter((l) => !isNoiseLine(l)).join("\n");
  const allMoney = [
    ...cleaned.matchAll(/(\d[\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|rub|rur|р\.)/gi),
  ];
  if (allMoney.length > 0) {
    const n = parseNumber(allMoney[allMoney.length - 1][1]);
    if (n !== undefined) return n;
  }

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
