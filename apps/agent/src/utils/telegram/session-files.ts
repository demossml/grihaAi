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
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** E4: TTL дедупа «недавно отправленных» файлов (10 минут). */
export const RECENT_SEND_TTL_MS = 10 * 60 * 1000;

/**
 * P3: порог content-hash дедупа. Файлы больше порога не хэшируются (защита от
 * чтения большого файла в RAM) — для них content-дедуп отключён, действуют
 * только realpath/dedupeKey-правила.
 */
export const CONTENT_HASH_MAX_BYTES = 16 * 1024 * 1024;

/** P3: SHA256 содержимого файла (hex) либо undefined (сбой / файл больше порога). */
export function sha256OfFileSync(filePath: string, maxBytes = CONTENT_HASH_MAX_BYTES): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

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
  /** P3: SHA256 содержимого (дополнительный сигнал дедупа). */
  contentSha256?: string;
}

const fileRegistry = new Map<string, SessionFileRecord>();
const buttonsRegistry = new Map<string, InlineButton[][]>();

interface RecentSend {
  realPath: string;
  dedupeKey?: string;
  /** P3: SHA256 содержимого на момент отправки. */
  contentSha256?: string;
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
  fileRegistry.set(sessionId, {
    filePath,
    caption,
    dedupeKey: opts?.dedupeKey,
    contentSha256: sha256OfFileSync(filePath),
  });
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
  contentSha256?: string,
): void {
  const list = recentRegistry.get(sessionId) ?? [];
  list.push({
    realPath: realPathOf(filePath),
    dedupeKey,
    contentSha256: contentSha256 ?? sha256OfFileSync(filePath),
    at: Date.now(),
  });
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

/**
 * P3: pending session-file с этим содержимым И стабильным dedupeKey
 * (сгенерированный отчёт) — копия того же отчёта подавляется.
 *
 * Без dedupeKey на записи content-дедуп не применяется: у произвольных
 * файлов нет логической identity, и одинаковый SHA256 ≠ тот же artifact.
 */
export function hasPendingContentSha256(sessionId: string, sha256: string | undefined): boolean {
  if (!sha256) return false;
  const rec = fileRegistry.get(sessionId);
  return rec?.dedupeKey !== undefined && rec.contentSha256 !== undefined && rec.contentSha256 === sha256;
}

/** P3: это содержимое (dedupeKey-артефакт) было отправлено в течение TTL? */
export function wasRecentlySentContentSha256(sessionId: string, sha256: string | undefined): boolean {
  if (!sha256) return false;
  return recentList(sessionId).some(
    (r) => r.dedupeKey !== undefined && r.contentSha256 !== undefined && r.contentSha256 === sha256,
  );
}

interface InFlightSend {
  realPath: string;
  contentSha256?: string;
}
const inFlightRegistry = new Map<string, InFlightSend[]>();

/**
 * P3: атомарно пометить артефакт как «отправляется сейчас» (concurrent
 * duplicate send_file). false — такой путь/содержимое уже отправляется,
 * второй вызов подавляется. Синхронно → нет окна между check и set.
 */
export function beginFileSend(sessionId: string, filePath: string, contentSha256?: string): boolean {
  const real = realPathOf(filePath);
  const list = inFlightRegistry.get(sessionId) ?? [];
  const clash = list.some(
    (e) => e.realPath === real || (contentSha256 !== undefined && e.contentSha256 === contentSha256),
  );
  if (clash) return false;
  list.push({ realPath: real, contentSha256 });
  inFlightRegistry.set(sessionId, list);
  return true;
}

/** P3: снять пометку «отправляется» (в finally после send_file). */
export function endFileSend(sessionId: string, filePath: string, contentSha256?: string): void {
  const real = realPathOf(filePath);
  const list = inFlightRegistry.get(sessionId);
  if (!list) return;
  const next = list.filter((e) => !(e.realPath === real && e.contentSha256 === contentSha256));
  if (next.length === 0) inFlightRegistry.delete(sessionId);
  else inFlightRegistry.set(sessionId, next);
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
    markRecentlySentFile(sessionId, record.filePath, record.dedupeKey, record.contentSha256);
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
