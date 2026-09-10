/**
 * maybeIngestDocument — политика инжеста файлов из Telegram (§6).
 * ACL/pre-filter/mention НЕ отменяются: ingest_mode "mention" (default) требует
 * mention/reply/ключевых слов в caption.
 */
import type { TelegramFileMessage } from "./DocumentIngestService.js";
import { documentAck } from "./DocumentIngestService.js";
import type { ExpenseDocument } from "./types.js";

export interface MaybeIngestDeps {
  /** ingest_mode из structured-правил чата; default "mention". */
  getIngestMode: (chatId: string) => string;
  isAllowed: (userId: string, chatId: string) => Promise<boolean>;
  ingest: (message: TelegramFileMessage) => Promise<ExpenseDocument>;
}

const CAPTION_HINT = /(чек|накладн|invoice|receipt|расход)/i;

export interface MaybeIngestOptions {
  /** Инжест без mention/reply/ключевых слов (listener / archive_ocr_ingest policy). */
  force?: boolean;
  /** Инжест выполнить, но ack не возвращать (фоновый путь без ответа в чат). */
  skipAck?: boolean;
}

export async function maybeIngestDocument(
  message: TelegramFileMessage,
  deps: MaybeIngestDeps,
  opts: MaybeIngestOptions = {},
): Promise<{ ack: string } | null> {
  const hasFile = Boolean(message.photo?.length || message.document);
  if (!hasFile) return null;

  const chatId = String(message.chat.id);
  const mode = deps.getIngestMode(chatId) || "mention";

  // B3: ingest_mode=mention НЕ блокирует force-путь (listener / archive_ocr_ingest).
  if (!opts.force && mode === "mention") {
    const mentioned = (message as { botMentioned?: boolean }).botMentioned === true;
    const replied = (message as { repliedToBot?: boolean }).repliedToBot === true;
    const captionHint = CAPTION_HINT.test(message.caption ?? "");
    if (!mentioned && !replied && !captionHint) return null;
  }

  const userId = message.from?.id !== undefined ? String(message.from.id) : "";
  if (!userId || !(await deps.isAllowed(userId, chatId))) return null;

  const doc = await deps.ingest(message);
  if (opts.skipAck) return null; // инжест выполнен тихо (bridge сам покажет expenseId агенту)
  return { ack: documentAck(doc) };
}
