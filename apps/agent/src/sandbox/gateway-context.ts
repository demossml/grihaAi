/**
 * Per-session trust registry for the gateway layer.
 *
 * The main interactive session is trusted by default; sub-agent and cron
 * sessions (created via `createRealSubAgentRunner`) are marked `untrusted`
 * right after their AgentSession is bound, so the gateway can block
 * shell/file-mutation tools for them.
 */

export type TrustLevel = "trusted" | "untrusted";

const registry = new Map<string, TrustLevel>();

export function setSessionTrust(sessionId: string, level: TrustLevel): void {
  registry.set(sessionId, level);
}

export function getSessionTrust(sessionId: string): TrustLevel {
  return registry.get(sessionId) ?? "trusted";
}

export function clearSessionTrust(sessionId: string): void {
  registry.delete(sessionId);
}
