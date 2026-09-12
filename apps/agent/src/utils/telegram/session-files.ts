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
import fs from "node:fs";
import path from "node:path";

/** Telegram inline keyboard button. */
export interface InlineButton {
  text: string;
  callbackData: string;
}

/** File payload: path plus an optional Telegram caption. */
export interface SessionFileRecord {
  filePath: string;
  caption?: string;
  /** R3: Telegram шлёт ТОЛЬКО файл — без текста, подписи и кнопок. */
  attachmentOnly?: boolean;
  /** R3: идемпотентность — повторная отправка с тем же ключом игнорируется. */
  dedupeKey?: string;
}

export interface SetSessionFileOptions {
  attachmentOnly?: boolean;
  dedupeKey?: string;
}

const fileRegistry = new Map<string, SessionFileRecord>();
const buttonsRegistry = new Map<string, InlineButton[][]>();

export function setSessionFile(
  sessionId: string,
  filePath: string,
  caption?: string,
  options?: SetSessionFileOptions,
): void {
  fileRegistry.set(sessionId, {
    filePath,
    caption,
    attachmentOnly: options?.attachmentOnly,
    dedupeKey: options?.dedupeKey,
  });
}

/** D1/D2: канонический путь (realpath с fallback) для сравнения. */
export function canonicalFilePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Заглянуть в pending-файл сессии, не забирая его (для дедупа send_file). */
export function peekSessionFileRecord(sessionId: string): SessionFileRecord | undefined {
  return fileRegistry.get(sessionId);
}

/** D2: файл с тем же (каноническим) путём уже ждёт автоотправки в этой сессии. */
export function hasPendingSessionFile(sessionId: string, filePath: string): boolean {
  const rec = fileRegistry.get(sessionId);
  if (!rec?.filePath) return false;
  return canonicalFilePath(rec.filePath) === canonicalFilePath(filePath);
}

// ── D2: «уже отправлен» — per-session Map с TTL 10 минут ────────────────────

const recentSent = new Map<string, number>();
const RECENT_SENT_TTL_MS = 10 * 60 * 1000;

function recentKey(sessionId: string, filePath: string): string {
  return `${sessionId}|${canonicalFilePath(filePath)}`;
}

export function wasRecentlySentFile(sessionId: string, filePath: string): boolean {
  const ts = recentSent.get(recentKey(sessionId, filePath));
  return ts !== undefined && Date.now() - ts < RECENT_SENT_TTL_MS;
}

export function markRecentlySentFile(sessionId: string, filePath: string): void {
  if (recentSent.size > 500) {
    const cutoff = Date.now() - RECENT_SENT_TTL_MS;
    for (const [k, ts] of recentSent) {
      if (ts < cutoff) recentSent.delete(k);
    }
  }
  recentSent.set(recentKey(sessionId, filePath), Date.now());
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
