/**
 * Per-session pending outbox for document delivery and inline keyboards.
 *
 * Tools that generate files (report-generator) record the output path (and an
 * optional caption) for the current session; the Telegram session pool picks it
 * up after `agent_end` and sends it as a document. The approval-gate records
 * inline buttons ("Одобрить"/"Отклонить") the same way: the Telegram layer
 * attaches them to the final reply as an inline keyboard. Same form as
 * `user-rules/context.ts` — registries keyed by session id, never a second
 * messaging channel.
 */

/** Telegram inline keyboard button. */
export interface InlineButton {
  text: string;
  callbackData: string;
}

/** File payload: path plus an optional Telegram caption. */
export interface SessionFileRecord {
  filePath: string;
  caption?: string;
}

const fileRegistry = new Map<string, SessionFileRecord>();
const buttonsRegistry = new Map<string, InlineButton[][]>();

export function setSessionFile(sessionId: string, filePath: string, caption?: string): void {
  fileRegistry.set(sessionId, { filePath, caption });
}

/** Return and clear the pending file for a session, if any (compat wrapper). */
export function takeSessionFile(sessionId: string): string | undefined {
  return takeSessionFileRecord(sessionId)?.filePath;
}

/** Return and clear the pending file record (path + caption) for a session. */
export function takeSessionFileRecord(sessionId: string): SessionFileRecord | undefined {
  const record = fileRegistry.get(sessionId);
  fileRegistry.delete(sessionId);
  return record;
}

/**
 * Queue inline keyboard rows for the session's next reply. Appends to any rows
 * already queued this turn (one row per approval request, for example).
 */
export function addSessionInlineButtons(sessionId: string, rows: InlineButton[][]): void {
  const existing = buttonsRegistry.get(sessionId) ?? [];
  buttonsRegistry.set(sessionId, [...existing, ...rows]);
}

/** Return and clear the queued inline keyboard rows for a session. */
export function takeSessionInlineButtons(sessionId: string): InlineButton[][] | undefined {
  const rows = buttonsRegistry.get(sessionId);
  buttonsRegistry.delete(sessionId);
  return rows;
}
