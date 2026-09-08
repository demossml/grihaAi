/**
 * Per-session Telegram context registry.
 *
 * The Telegram session pool sets the current chat/user context right before
 * calling `session.prompt(...)`; the user-rules `before_agent_start` handler
 * reads it via the session id to know which chat (and user) the turn belongs
 * to. This is what lets soft rules be scoped per chat without an LLM call.
 */

export interface SessionChatContext {
  chatId: string;
  userId: string;
}

const registry = new Map<string, SessionChatContext>();

export function setSessionContext(
  sessionId: string,
  context: SessionChatContext | undefined,
): void {
  if (context) registry.set(sessionId, context);
  else registry.delete(sessionId);
}

export function getSessionContext(sessionId: string): SessionChatContext | undefined {
  return registry.get(sessionId);
}

export function clearSessionContext(sessionId: string): void {
  registry.delete(sessionId);
}
