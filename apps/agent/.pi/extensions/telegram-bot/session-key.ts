/**
 * D2: канонический session key — изоляция истории по чату (и теме форума).
 *
 *   DM:    tg:{userId}:{chatId}
 *   Group: tg:{userId}:{chatId}
 *   Topic: tg:{userId}:{chatId}:t:{threadId}
 */
export function buildTelegramSessionKey(input: {
  userId: number | string;
  chatId?: number | string;
  threadId?: string;
}): string {
  const uid = String(input.userId);
  const chat = input.chatId !== undefined ? String(input.chatId) : "dm";
  const thread = input.threadId ? `:t:${input.threadId}` : "";
  return `tg:${uid}:${chat}${thread}`;
}

/** Безопасное имя каталога (убираем path-traversal). */
export function sanitizeDirSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, "_");
}
