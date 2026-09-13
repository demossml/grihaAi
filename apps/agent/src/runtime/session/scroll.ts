/**
 * Phase 4 (Item 4.1, матрица D2) — scroll/browse контракт для поиска сессий.
 *
 * Hermes: FTS5 session search + scroll. Сейчас `searchSessions` (SqliteRagMemory)
 * отдаёт только LIMIT без offset. Этот модуль задаёт чистую семантику курсора
 * и нарезки; wiring в SQL — за флагом `HERMES_AGENT_RUNTIME`.
 */

export interface ScrollCursorData {
  offset: number;
  /** Стабильный ключ сортировки (score DESC) для page после первого. */
  sortKey?: number;
}

export interface ScrollPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const CURSOR_PREFIX = "s1.";

/** Opaque base64url-курсор. */
export function buildScrollCursor(data: ScrollCursorData): string {
  const json = JSON.stringify({ offset: data.offset, sortKey: data.sortKey });
  return CURSOR_PREFIX + Buffer.from(json, "utf8").toString("base64url");
}

/** Разбор курсора; мусор/неверный формат → null (не бросает). */
export function parseScrollCursor(cursor: string | null | undefined): ScrollCursorData | null {
  if (typeof cursor !== "string" || !cursor.startsWith(CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    ) as ScrollCursorData;
    if (typeof parsed.offset !== "number" || parsed.offset < 0) return null;
    return { offset: parsed.offset, sortKey: typeof parsed.sortKey === "number" ? parsed.sortKey : undefined };
  } catch {
    return null;
  }
}

/** Нарезка отсортированного списка по курсору (семантика scroll в памяти). */
export function sliceByCursor<T>(
  items: readonly T[],
  cursor: string | null | undefined,
  pageSize: number,
): ScrollPage<T> {
  const offset = cursor ? (parseScrollCursor(cursor)?.offset ?? 0) : 0;
  const size = Math.max(1, pageSize);
  const page = items.slice(offset, offset + size);
  const hasMore = offset + page.length < items.length;
  const next = hasMore
    ? buildScrollCursor({ offset: offset + page.length })
    : null;
  return { items: page, nextCursor: next, hasMore };
}

/** SQL OFFSET для будущего wiring (keyset/offset по стабильной сортировке). */
export function sqlOffsetFor(cursor: string | null | undefined): number {
  return parseScrollCursor(cursor)?.offset ?? 0;
}
