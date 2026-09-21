/**
 * Форматирование/парсинг превью текста и позиций чека.
 */

export function previewText(raw: string | null | undefined, max = 200): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max) + "…";
}

export function parseItemsJson(
  itemsJson: string | null | undefined,
): Array<{ name: string; qty?: number; sum?: number }> {
  if (!itemsJson) return [];
  try {
    const v = JSON.parse(itemsJson);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string")
      .map((x) => {
        const o = x as { name: string; qty?: number; sum?: number };
        return {
          name: o.name,
          qty: typeof o.qty === "number" ? o.qty : undefined,
          sum: typeof o.sum === "number" ? o.sum : undefined,
        };
      });
  } catch {
    return [];
  }
}
