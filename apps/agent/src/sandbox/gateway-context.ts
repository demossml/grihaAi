/**
 * Per-session trust registry for the gateway layer.
 *
 * Default DENY elevation: unknown sessionId → "untrusted". The main interactive
 * (TUI/headless bot) session is explicitly marked "trusted"; Telegram, sub-agent
 * and cron sessions are marked "untrusted" right after their AgentSession is
 * bound, so the gateway can block shell/execute_code/file mutation for them.
 */

export type TrustLevel = "trusted" | "untrusted";

const registry = new Map<string, TrustLevel>();

export function setSessionTrust(sessionId: string, level: TrustLevel): void {
  registry.set(sessionId, level);
}

export function getSessionTrust(sessionId: string): TrustLevel {
  return registry.get(sessionId) ?? "untrusted";
}

export function clearSessionTrust(sessionId: string): void {
  registry.delete(sessionId);
}
