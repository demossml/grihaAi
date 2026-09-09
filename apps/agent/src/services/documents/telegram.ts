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

export async function maybeIngestDocument(
  message: TelegramFileMessage,
  deps: MaybeIngestDeps,
): Promise<{ ack: string } | null> {
  const hasFile = Boolean(message.photo?.length || message.document);
  if (!hasFile) return null;

  const chatId = String(message.chat.id);
  const mode = deps.getIngestMode(chatId) || "mention";

  if (mode === "mention") {
    const mentioned = (message as { botMentioned?: boolean }).botMentioned === true;
    const replied = (message as { repliedToBot?: boolean }).repliedToBot === true;
    const captionHint = CAPTION_HINT.test(message.caption ?? "");
    if (!mentioned && !replied && !captionHint) return null;
  }

  const userId = message.from?.id !== undefined ? String(message.from.id) : "";
  if (!userId || !(await deps.isAllowed(userId, chatId))) return null;

  const doc = await deps.ingest(message);
  return { ack: documentAck(doc) };
}
