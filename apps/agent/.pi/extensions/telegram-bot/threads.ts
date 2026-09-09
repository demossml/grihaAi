/**
 * Forum topics: канонический id темы.
 * undefined/null = не сообщение из темы форума (обычная группа или DM).
 */
export type ThreadId = string | undefined;

export function normalizeThreadId(value: number | string | null | undefined): ThreadId {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

/**
 * message_thread_id берётся из самого сообщения; fallback — reply_to_message
 * (reply в теме обычно несёт thread id на message).
 */
export function extractThreadIdFromMessage(message: {
  message_thread_id?: number;
  reply_to_message?: { message_thread_id?: number };
}): ThreadId {
  return normalizeThreadId(
    message.message_thread_id ?? message.reply_to_message?.message_thread_id,
  );
}
