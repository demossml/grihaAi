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
