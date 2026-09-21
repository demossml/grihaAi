/**
 * Резолв названия группы → chatId (только private). Чистая функция.
 * Поиск среди setup-записей (chatTitle), а не по всему архиву.
 */

export interface GroupTitleRecord {
  chatId: string;
  chatTitle?: string | null;
}

export type ResolveGroupQueryResult =
  | { ok: true; chatId: string; title: string | null }
  | {
      ok: false;
      code: "NOT_FOUND" | "AMBIGUOUS" | "EMPTY_QUERY";
      message: string;
      candidates?: Array<{ chatId: string; title: string | null }>;
    };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е");
}

/**
 * records — список setup-чатов (уже отфильтрованный по ACL при необходимости).
 */
export function resolveGroupQuery(
  query: string,
  records: GroupTitleRecord[],
): ResolveGroupQueryResult {
  const q = norm(query);
  if (!q) {
    return { ok: false, code: "EMPTY_QUERY", message: "Пустой запрос названия группы." };
  }
  const withTitle = records
    .map((r) => ({ chatId: r.chatId, title: r.chatTitle?.trim() || null }))
    .filter((r) => r.title);

  const exact = withTitle.filter((r) => norm(r.title!) === q);
  if (exact.length === 1) {
    return { ok: true, chatId: exact[0].chatId, title: exact[0].title };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS",
      message: "Несколько групп с таким названием. Укажите chatId.",
      candidates: exact.slice(0, 10),
    };
  }

  const partial = withTitle.filter(
    (r) => norm(r.title!).includes(q) || q.includes(norm(r.title!)),
  );
  if (partial.length === 1) {
    return { ok: true, chatId: partial[0].chatId, title: partial[0].title };
  }
  if (partial.length > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS",
      message: "Несколько групп похожи на запрос. Уточните название или chatId.",
      candidates: partial.slice(0, 10),
    };
  }
  return {
    ok: false,
    code: "NOT_FOUND",
    message: "Группа с таким названием не найдена в настроенных чатах.",
  };
}
