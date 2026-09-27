/**
 * Канонизация и отбраковка мусора OCR для поля supplier / category отчёта.
 * Детерминированно, без LLM. Один источник канона для intake и report.
 */
export function normalizeSupplier(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return undefined;

  // 1) Канонические сети/банки ДО isJunk — «Банк Точка БИК…» → «Банк Точка»,
  //    «…СБЕРБАНК…БИК…» → «Сбербанк», ozon-url → «Ozon».
  const canon = matchCanonical(s);
  if (canon) return canon;

  // 2) Явный мусор OCR → undefined (needsReview решит computeNeedsReview).
  if (isJunkSupplier(s)) return undefined;

  // 3) Обрезка хвостов типа « (накладная)», « (РМ№2)».
  s = s
    .replace(/\s*\((?:накладная|счёт|счет|чек)[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isJunkSupplier(s)) return undefined;
  if (s.length < 2) return undefined;
  return s.slice(0, 80);
}

function isJunkSupplier(s: string): boolean {
  const t = s.toLowerCase();
  if (/https?\s*:?\s*\/\//i.test(s) || /www\s*\.\s*ozon/i.test(t)) return true;
  if (/бик(?![а-яёa-z0-9])/i.test(s)) return true;
  if (/отделение/i.test(s)) return true;
  if (/^\s*покупатель(?![а-яёa-z0-9])/i.test(s)) return true;
  if (/^\s*получатель(?![а-яёa-z0-9])/i.test(s)) return true;
  if (/^\s*собственник(?![а-яёa-z0-9])/i.test(s)) return true;
  if (/кассовый\s*чек/i.test(s)) return true;
  if (/товарный\s*чек/i.test(s)) return true;
  if (/^\s*продажа\s*№/i.test(s)) return true;
  if (/^\s*счёт\s*\(/i.test(s) || /^\s*счет\s*\(/i.test(s)) return true;
  // сырая строка таблицы OCR
  if (/^\s*\|/.test(s) && /шт/i.test(s)) return true;
  if (s.length > 60 && /сбербанк|бик|ул\s/i.test(s)) return true;
  return false;
}

function matchCanonical(s: string): string | undefined {
  const u = s.toUpperCase().replace(/Ё/g, "Е");
  // Магнит: МАГНИТ, М МАГНИТ, M МАГНИТ, МАГНИТ (Милан)
  if (/МАГНИТ|MAGNIT/.test(u)) return "Магнит";
  if (/ПЯТ[ЕЁ]РОЧК|PYATEROCHKA|5\s*ПЯТ/.test(u)) return "Пятёрочка";
  if (/OZON|ОЗОН/.test(u)) return "Ozon";
  if (/WILDBERRIES|\bWB\b|ВАЙЛДБЕРР/.test(u)) return "Wildberries";
  if (/ЛЕНТА/.test(u) && !/ленточн/i.test(s)) return "Лента";
  if (/БАНК\s*ТОЧКА|ТОЧКА\s*БАНК/.test(u)) return "Банк Точка";
  if (/СБЕРБАНК|СБЕР(?![А-ЯЁA-Z0-9])/.test(u)) return "Сбербанк";
  if (/ПОБЕДА/.test(u) && u.length < 40) return "Победа";
  return undefined;
}
