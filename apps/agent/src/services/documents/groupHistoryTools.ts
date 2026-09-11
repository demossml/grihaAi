/**
 * group_history / group_recent — чтение архива групп из chat_archive.
 *
 * Жёсткий ACL (H1–H3, H6): история доступна ТОЛЬКО если чат configured
 * (completed|skipped) И (caller allowed в чате ИЛИ canManage).
 * H4: наружу — только поля из ChatArchiveRecord (storageKey допустим, пути — нет).
 * H5: history default 30 max 100; recent default 20 max 50, sinceHours 1..168.
 */
import type { DocumentsRepository } from "./DocumentsRepository.js";
import type { ChatArchiveRecord } from "./chat-archive.js";

export const ACCESS_DENIED = "Чат не настроен или нет доступа.";

/** Зависимости ACL — заменяемы в тестах. */
export interface GroupAccessDeps {
  isConfiguredSync: (chatId: string) => boolean;
  canManage: (userId: string) => Promise<boolean>;
  isAllowed: (userId: string, chatId: string) => Promise<boolean>;
  /** configured chatIds (completed|skipped) для group_recent без chatId. */
  listConfiguredChatIds: () => Promise<string[]>;
}

/** H2/H3: (a) configured + (b) allowed или canManage. */
export async function assertCanReadChat(
  userId: string,
  chatId: string,
  deps: GroupAccessDeps,
): Promise<boolean> {
  if (!deps.isConfiguredSync(chatId)) return false;
  if (await deps.canManage(userId)) return true;
  return deps.isAllowed(userId, chatId);
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

/** Обрезка длинного текста (500 символов) + флаг truncated. */
function truncate(text: string, max = 500): { value: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return { value: clean, truncated: false };
  return { value: clean.slice(0, max), truncated: true };
}

export type ArchiveItemKind =
  | "text"
  | "photo"
  | "document"
  | "voice"
  | "video"
  | "other";

const KIND_ALIASES: Record<string, ArchiveKindLiteral[]> = {
  other: ["video_note", "audio", "expense"],
};

type ArchiveKindLiteral = ChatArchiveRecord["kind"];

/** Compact, LLM-friendly элемент архива (без сырых путей и токенов, H4). */
export function formatArchiveItem(rec: ChatArchiveRecord): Record<string, unknown> {
  const body = rec.kind === "text" ? rec.rawText : rec.caption;
  const ocr = rec.kind !== "text" ? rec.rawText : undefined;
  const item: Record<string, unknown> = {
    messageId: rec.messageId,
    ...(rec.threadId ? { threadId: rec.threadId } : {}),
    at: rec.createdAt,
    kind: rec.kind,
    ...(rec.fromUserId ? { fromUserId: rec.fromUserId } : {}),
    ...(body ? { text: truncate(body, 500).value } : {}),
    ...(ocr ? (() => { const t = truncate(ocr, 500); return { ocrText: t.value, ...(t.truncated ? { truncated: true } : {}) }; })() : {}),
    hasMedia: Boolean(rec.fileId || rec.fileUniqueId || rec.fileName),
    ...(rec.storageKey ? { storageKey: rec.storageKey } : {}),
    ...(rec.expenseId ? { expenseId: rec.expenseId } : {}),
  };
  return item;
}

/** §4: тихий брифинг по чеку — без file_id, без технической шелухи. */
export function formatExpenseBrief(info: {
  supplier?: string;
  total: number;
  currency?: string;
  docDate?: string;
}): string {
  const supplier = info.supplier?.trim() || "без названия";
  return `Чек: ${supplier} — ${info.total} ${info.currency ?? "RUB"}, ${info.docDate ?? ""}`;
}

export interface GroupHistoryArgs {
  chatId?: string;
  threadId?: string;
  limit?: number;
  beforeMessageId?: string;
  kinds?: string[];
  fromDate?: string;
  toDate?: string;
}

export interface GroupRecentArgs {
  chatId?: string;
  sinceHours?: number;
  limit?: number;
}

export interface GroupToolsContext {
  /** Текущий чат сессии (default). */
  chatId?: string;
  /** Actor user id сессии. */
  userId?: string;
}

/** Расширить kinds: «other» → video_note/audio/expense. */
export function expandKinds(kinds?: string[]): ArchiveKindLiteral[] | undefined {
  if (!kinds || kinds.length === 0) return undefined;
  const out: ArchiveKindLiteral[] = [];
  for (const k of kinds) {
    out.push(...(KIND_ALIASES[k] ?? [k as ArchiveKindLiteral]));
  }
  return out;
}

export async function groupHistoryHandler(
  args: GroupHistoryArgs,
  ctx: GroupToolsContext,
  repo: DocumentsRepository,
  deps: GroupAccessDeps,
): Promise<string> {
  const chatId = args.chatId ?? ctx.chatId;
  if (!chatId) return "Укажите chatId: текущий чат сессии не определён.";
  const userId = ctx.userId;
  if (!userId) return "Не определён пользователь сессии.";

  if (!(await assertCanReadChat(userId, chatId, deps))) return ACCESS_DENIED;

  const limit = clampInt(args.limit ?? 30, 1, 100);
  const rows = repo.listMessages({
    chatId,
    threadId: args.threadId !== undefined && args.threadId !== "" ? args.threadId : undefined,
    limit,
    beforeMessageId: args.beforeMessageId !== undefined && args.beforeMessageId !== "" ? args.beforeMessageId : undefined,
    kinds: expandKinds(args.kinds),
    fromDate: args.fromDate !== undefined && args.fromDate !== "" ? args.fromDate : undefined,
    toDate: args.toDate !== undefined && args.toDate !== "" ? args.toDate : undefined,
  });

  return JSON.stringify({
    chatId,
    count: rows.length,
    items: rows.map(formatArchiveItem),
  });
}

export async function groupRecentHandler(
  args: GroupRecentArgs,
  ctx: GroupToolsContext,
  repo: DocumentsRepository,
  deps: GroupAccessDeps,
): Promise<string> {
  const userId = ctx.userId;
  if (!userId) return "Не определён пользователь сессии.";

  const limit = clampInt(args.limit ?? 20, 1, 50);
  const sinceHours = clampInt(args.sinceHours ?? 24, 1, 168);
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  let chatIds: string[];
  if (args.chatId !== undefined && args.chatId !== "") {
    if (!(await assertCanReadChat(userId, args.chatId, deps))) return ACCESS_DENIED;
    chatIds = [args.chatId];
  } else {
    const configured = await deps.listConfiguredChatIds();
    if (await deps.canManage(userId)) {
      chatIds = configured;
    } else {
      const allowed: string[] = [];
      for (const c of configured) {
        if (await deps.isAllowed(userId, c)) allowed.push(c);
      }
      chatIds = allowed;
    }
    // Cap 10 чатов по недавней активности (H5).
    chatIds = repo.topRecentChats(chatIds, 10);
  }

  if (chatIds.length === 0) {
    return JSON.stringify({ chats: [], since: sinceIso, count: 0, items: [] });
  }

  const rows = repo.listRecent({ chatIds, sinceIso, limit });
  return JSON.stringify({
    chats: chatIds,
    since: sinceIso,
    count: rows.length,
    items: rows.map(formatArchiveItem),
  });
}
