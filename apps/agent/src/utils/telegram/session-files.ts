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
 *
 * E4: дедуп повторной отправки — pending-файл и недавно отправленные файлы
 * (TTL 10 мин) по realpath/dedupeKey; send_file подавляется, если файл уже
 * стоит в очереди session-file или был отправлен.
 */
import fs from "node:fs";
import path from "node:path";

/** E4: TTL дедупа «недавно отправленных» файлов (10 минут). */
export const RECENT_SEND_TTL_MS = 10 * 60 * 1000;

/** Telegram inline keyboard button. */
export interface InlineButton {
  text: string;
  callbackData: string;
}

/** File payload: path plus an optional Telegram caption. */
export interface SessionFileRecord {
  filePath: string;
  caption?: string;
  /** E4: стабильный ключ дедупа (например, "expense-report"). */
  dedupeKey?: string;
}

const fileRegistry = new Map<string, SessionFileRecord>();
const buttonsRegistry = new Map<string, InlineButton[][]>();

interface RecentSend {
  realPath: string;
  dedupeKey?: string;
  at: number;
}

const recentRegistry = new Map<string, RecentSend[]>();

function realPathOf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function setSessionFile(
  sessionId: string,
  filePath: string,
  caption?: string,
  opts?: { dedupeKey?: string },
): void {
  fileRegistry.set(sessionId, { filePath, caption, dedupeKey: opts?.dedupeKey });
}

/** Текущий pending-файл сессии без удаления (для дедупа). */
export function peekSessionFileRecord(sessionId: string): SessionFileRecord | undefined {
  return fileRegistry.get(sessionId);
}

/** E4: тот же файл уже стоит в очереди session-file этой сессии? */
export function hasPendingSessionFile(sessionId: string, filePath: string): boolean {
  const rec = fileRegistry.get(sessionId);
  if (!rec) return false;
  return realPathOf(rec.filePath) === realPathOf(filePath);
}

/** E4: pending-файл зарегистрирован с этим dedupeKey? */
export function hasPendingDedupeKey(sessionId: string, dedupeKey: string): boolean {
  const rec = fileRegistry.get(sessionId);
  return rec?.dedupeKey !== undefined && rec.dedupeKey === dedupeKey;
}

/** E4: пометить файл как недавно отправленный (вызывается на take). */
export function markRecentlySentFile(
  sessionId: string,
  filePath: string,
  dedupeKey?: string,
): void {
  const list = recentRegistry.get(sessionId) ?? [];
  list.push({ realPath: realPathOf(filePath), dedupeKey, at: Date.now() });
  recentRegistry.set(sessionId, list);
}

function recentList(sessionId: string): RecentSend[] {
  const now = Date.now();
  const list = (recentRegistry.get(sessionId) ?? []).filter(
    (r) => now - r.at < RECENT_SEND_TTL_MS,
  );
  if (list.length === 0) {
    recentRegistry.delete(sessionId);
  } else {
    recentRegistry.set(sessionId, list);
  }
  return list;
}

/** E4: файл был отправлен в течение TTL? */
export function wasRecentlySentFile(sessionId: string, filePath: string): boolean {
  const real = realPathOf(filePath);
  return recentList(sessionId).some((r) => r.realPath === real);
}

/** E4: dedupeKey был отправлен в течение TTL? */
export function wasRecentlySentDedupeKey(sessionId: string, dedupeKey: string): boolean {
  return recentList(sessionId).some((r) => r.dedupeKey !== undefined && r.dedupeKey === dedupeKey);
}

/** Return and clear the pending file for a session, if any (compat wrapper). */
export function takeSessionFile(sessionId: string): string | undefined {
  return takeSessionFileRecord(sessionId)?.filePath;
}

/** Return and clear the pending file record (path + caption) for a session. */
export function takeSessionFileRecord(sessionId: string): SessionFileRecord | undefined {
  const record = fileRegistry.get(sessionId);
  fileRegistry.delete(sessionId);
  if (record) {
    // E4: доставка состоялась — файл считается недавно отправленным (TTL),
    // чтобы повторный send_file того же пути подавлялся.
    markRecentlySentFile(sessionId, record.filePath, record.dedupeKey);
  }
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
