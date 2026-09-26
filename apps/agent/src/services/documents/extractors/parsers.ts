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

/** 10–12 цифр БЕЗ десятичной части → похоже на ИНН/ФН/номер (не цена). */
function looksLikeInn(raw: string): boolean {
  const s = raw.replace(/\s/g, "");
  if (/[.,]/.test(s)) return false;
  return /^\d{10,12}$/.test(s);
}

/** Строки, которые НИКОГДА не могут быть позицией/суммой (служебные/ИНН). */
const REJECT_LINE_RE =
  /инн|кпп|фн\b|фд\b|фп\b|ккт|сайт\s*фнс|кассовый\s*чек|благодар|всего\s*позиц|итого|сдача|наличн|безналич|карта\s*№|терминал/i;

/** Строки, из которых запрещено брать total (ИНН/КПП/ФН/регистрация). */
const TOTAL_FORBIDDEN_RE = /инн|кпп|фн\b|фд\b|фп\b|рн\s*ккт|сайт\s*фнс|регистрац/i;

/** Якоря итога по приоритету (регистронезависимо). Длинные — раньше коротких,
 *  чтобы «итог» не съедал «итог к оплате»/«итого». */
const TOTAL_ANCHOR_RE =
  /(?:итого|всего\s+к\s+оплате|итог\s+к\s+оплате|сумма\s+к\s+оплате|итог)\s*[.:=\-\s]*([\d\s]+(?:[.,]\d{1,2})?)/i;

/** «сумма НДС» / «итого НДС» — это НЕ total чека (только если нет ИТОГО). */
const VAT_ONLY_RE = /сумма\s*(?:ндс|без\s*ндс)|итого\s*ндс/i;

/** Строка-заголовок юрлица/бренда — не позиция чека (name-only отсечка). */
const SUPPLIER_HEADER_RE =
  /ООО|ИП\b|ЗАО|ПАО|АО\b|МАГНИТ|ЛЕНТА|ПЯТЁРОЧКА|ПЕРЕКРЁСТОК|ВКУСВИЛЛ|АШАН|OZON|WILDBERRIES/i;

export interface ParsedItem {
  name: string;
  qty?: number;
  sum?: number;
}

/**
 * Построчный разбор позиций чека/накладной.
 * Паттерны:
 *   - «Наименование — 96», «Наименование ... 3225» (имя слева, цена в конце строки)
 *   - «96 Наименование» (цена слева) — реже
 *   - «Наименование 2 шт × 129» — количество + цена
 *   - «Наименование 217,90×25 — 5447,50» — цена за шт × кол-во = сумма
 * Возвращает массив позиций; строки без уверенной цены сохраняются с name-only.
 * Не выдумывает: сумма позиции ставится только при явном числе в строке.
 */
export function parseItemsFromText(text: string): ParsedItem[] {
  if (!text) return [];

  const result: ParsedItem[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const stopLines = /^(итого|сумма|оплачено|всего|сдача|итог|total|sum)/i;

  // Сначала найдём строки с ценами, чтобы отсечь name-only заголовки.
  const hasPricedLine = lines.some((l) => /[—–:-]\s*\d[\d\s]*(?:[.,]\d{1,2})?/.test(l) || /\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:₽|руб|rub|р\.)/.test(l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (stopLines.test(line)) continue;
    // Служебные/ИНН-строки («КАССОВЫЙ ЧЕК», «ПОБЕДА ООО» без цены и т.п.) — не позиции.
    if (REJECT_LINE_RE.test(line)) continue;

    // пропускаем чисто служебные строки (заголовки и валюта без товара)
    if (/^[\d\s.,]+(?::[\d]+)?$/.test(line)) continue;

    // «имя × qty — сумма» / «имя qty × цена»
    const nameThenQtySum =
      /^(.+?)\s*(?:×|x|\*)\s*(\d{1,4})\s*[—–:-]\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\b/.exec(
        line,
      );
    if (nameThenQtySum) {
      const name = cleanItemName(nameThenQtySum[1]);
      if (!name) continue;
      const sum = parseItemSum(nameThenQtySum[3]);
      if (sum === undefined) continue; // ИНН-like или нуль — не позиция
      result.push({
        name,
        qty: Number(nameThenQtySum[2]) || undefined,
        sum,
      });
      continue;
    }

    // «имя ... число(с валютой?)» — цена в конце строки
    const trailingPrice =
      /^(.{2,60}?)\s+[—–:-]?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|rub|р\.)?\s*$/.exec(
        line,
      );
    if (trailingPrice) {
      const name = cleanItemName(trailingPrice[1]);
      const sum = parseItemSum(trailingPrice[2]);
      if (name && sum !== undefined) {
        result.push({ name, sum });
        continue;
      }
      // возможно цена слева «96 Наименование»
    }

    // «цена Наименование» — число в начале строки
    const leadingPrice =
      /^(\d[\d\s]*(?:[.,]\d{1,2})?)\s+(?:₽|руб|rub)?\s*[—–:-]?\s+(.{2,60}?)\s*$/.exec(
        line,
      );
    if (leadingPrice) {
      const sum = parseItemSum(leadingPrice[1]);
      const name = cleanItemName(leadingPrice[2]);
      if (name && sum !== undefined) {
        result.push({ name, sum });
        continue;
      }
    }

    // строка без цены — имя, если похоже на товар (содержит буквы и достаточно длинное).
    // Отсекаем name-only заголовок (первая строка, если в чеке есть строки с ценами).
    if (/[А-Яа-яЁёA-Za-z]{3,}/.test(line) && line.length >= 4) {
      if (SUPPLIER_HEADER_RE.test(line)) continue; // юрлицо/бренд — не позиция
      if (hasPricedLine && i === 0) continue; // вероятный заголовок поставщика
      const name = cleanItemName(line);
      if (name) result.push({ name });
    }
  }

  return result;
}

function cleanItemName(name: string): string {
  return name
    .replace(/[«»"'.,!?;:]+$/g, "")
    .replace(/^[\s—–:-]+/, "")
    .trim();
}

/** Локальная нормализация числа (руб-формат: «1 000,02», «217,90»). */
function parseNumberLocal(raw: string): number | undefined {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Сумма позиции: отбрасывает ИНН-like (10–12 цифр без копеек) и нуль. */
function parseItemSum(raw: string): number | undefined {
  if (looksLikeInn(raw)) return undefined;
  return parseNumberLocal(raw);
}

/** Сумма из текста: «15400 ₽», «итого 1 500,50 руб», «сумма: 15400». */
export function parseTotalFromText(text: string): number | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // 1) Приоритетные якоря ИТОГО/ИТОГ/ВСЕГО К ОПЛАТЕ…, пропуская запрещённые строки.
  for (const line of lines) {
    if (TOTAL_FORBIDDEN_RE.test(line)) continue;
    const m = TOTAL_ANCHOR_RE.exec(line);
    if (!m) continue;
    if (looksLikeInn(m[1])) continue;
    const v = parseNumber(m[1]);
    if (v !== undefined) return v;
  }

  // 2) fallback: сумма/оплачено (но НЕ «сумма НДС») + явная валюта.
  for (const line of lines) {
    if (TOTAL_FORBIDDEN_RE.test(line)) continue;
    if (VAT_ONLY_RE.test(line)) continue;
    const m =
      /(?:сумма|оплачено|total|sum)\s*[.:=\-\s]*([\d\s]+(?:[.,]\d{1,2})?)\s*(?:₽|руб|rub|р\.)?/i.exec(
        line,
      );
    if (!m) continue;
    if (looksLikeInn(m[1])) continue;
    const v = parseNumber(m[1]);
    if (v !== undefined) return v;
  }

  // 3) просто число + валюта (без якоря), но с ИНН-отсечкой.
  const money = /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|rub|rur|р\.)/i.exec(text);
  if (money && !looksLikeInn(money[1])) return parseNumber(money[1]);
  return undefined;
}

/** Дата из текста: dd.mm.yyyy | dd/mm/yyyy | yyyy-mm-dd → YYYY-MM-DD. */
export function parseDateFromText(text: string): string | undefined {
  if (!text) return undefined;
  const currentYear = new Date().getFullYear();
  const yearOk = (y: number): boolean => y >= currentYear - 5 && y <= currentYear + 1;

  const dm = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  if (dm) {
    const [, d, m, y] = dm;
    const year = y.length === 2 ? `20${y}` : y;
    const yy = Number(year);
    if (!yearOk(yy)) return undefined; // мусор OCR (2028 и т.п.)
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${year}-${mm}-${dd}`;
    }
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    if (!yearOk(Number(iso[1]))) return undefined;
    return iso[0];
  }
  return undefined;
}

/**
 * Поставщик из текста: «чек из Ромашки», «накладная от ООО Ромашка»,
 * либо первая строка с юрлицом/брендом (ООО/ИП/МАГНИТ/…) в первых ~15 строках.
 * Возвращает undefined, если паттерн не найден (честный needsReview).
 */
export function parseSupplierFromText(text: string): string | undefined {
  if (!text) return undefined;

  // 1) Явный паттерн «чек/накладная/счёт из/от X».
  const m =
    /(?:чек|накладн[а-яё]*|счёт|счет|invoice|receipt|waybill)\s+(?:из|от|с|по|from)\s*[:\-—]?\s*([А-Яа-яЁёA-Za-z0-9«»"' ]{2,40})/i.exec(
      text,
    );
  if (m) {
    const raw = m[1].replace(/[«»"'.,!?]+$/g, "").trim();
    const stop = /(?:итого|сумма|оплачено|total|sum|\d)/i.exec(raw);
    const cleaned = stop ? raw.slice(0, stop.index).trim() : raw;
    if (cleaned.length >= 2) return cleaned;
  }

  // 2) Первая осмысленная строка с юрлицом/брендом в первых ~15 строках OCR.
  const COMPANY_RE = /ООО|ИП|ЗАО|ПАО|АО/i;
  const BRAND_RE = /МАГНИТ|ЛЕНТА|ПЯТЁРОЧКА|ПЕРЕКРЁСТОК|ВКУСВИЛЛ|АШАН|OZON|WILDBERRIES/i;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 15);
  for (const line of lines) {
    if (TOTAL_FORBIDDEN_RE.test(line)) continue;
    if (/кассовый\s*чек|товарный\s*чек|электронный\s*чек/i.test(line)) continue;

    if (COMPANY_RE.test(line)) {
      // «ООО "Ромашка"» / «Ромашка ООО» → «Ромашка» (убираем маркер и кавычки).
      const cleaned = line
        .replace(/[«»"'.,!?;:]+/g, " ")
        .replace(/(?:ООО|ИП|ЗАО|ПАО|АО)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 2) return cleaned.slice(0, 120);
      continue;
    }

    if (BRAND_RE.test(line)) {
      const cleaned = line.replace(/[«»"'.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length >= 2) return cleaned.slice(0, 120);
    }
  }
  return undefined;
}

/**
 * needsReview: детерминированная проверка, что чек нельзя считать «чистым».
 * true если total/supplier/date пусты ИЛИ items пусты при длинном rawText.
 */
export function computeNeedsReview(e: {
  total?: number;
  supplier?: string;
  docDate?: string;
  items?: Array<{ name: string; qty?: number; sum?: number }>;
  rawText?: string;
}): boolean {
  if (e.total == null) return true;
  if (!e.supplier) return true;
  if (!e.docDate) return true;
  const rawLen = e.rawText?.length ?? 0;
  if (rawLen > 80 && (!e.items || e.items.length === 0)) return true;
  return false;
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
