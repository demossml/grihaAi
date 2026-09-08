/**
 * Per-session pending-file registry for document delivery.
 *
 * Tools that generate files (report-generator) record the output path for the
 * current session; the Telegram session pool picks it up after `agent_end` and
 * sends it as a document. Same form as `user-rules/context.ts` — a registry
 * keyed by session id, never a second messaging channel.
 */

const registry = new Map<string, string>();

export function setSessionFile(sessionId: string, filePath: string): void {
  registry.set(sessionId, filePath);
}

/** Return and clear the pending file for a session, if any. */
export function takeSessionFile(sessionId: string): string | undefined {
  const filePath = registry.get(sessionId);
  registry.delete(sessionId);
  return filePath;
}
