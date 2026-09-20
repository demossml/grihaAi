/**
 * Общие форматтеры чисел для шаблонов (деньги/счётчики).
 */

export function formatMoney(n: number, currency = "₽"): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatCount(n: number): string {
  return String(Number.isFinite(n) ? n : 0);
}

/**
 * Извлечь число из денежной метки вида "10 000,00 ₽" / "1.234,00 ₽".
 * Для масштабирования bars. Невалидное → 0.
 */
export function parseMoneyLabel(label: string): number {
  if (!label) return 0;
  const cleaned = label
    .replace(/[^\d.,\-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const v = Number.parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}
