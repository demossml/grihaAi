/**
 * Privacy data hygiene — deterministic detection of secrets that must never be
 * written to long-term memory. Pure function, unit-tested; the sqlite-rag-memory
 * extension refuses to store content that matches.
 */

export interface SecretMatch {
  kind: string;
}

const SECRET_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "api key", re: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i },
  { kind: "password", re: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i },
  { kind: "token", re: /\b(?:access[_-]?token|auth[_-]?token|session[_-]?token|bearer)\s*[:=]?\s*[A-Za-z0-9_\-\.]{16,}/i },
  // Telegram bot token shape: <digits>:<alphanumerics with dash/underscore>
  { kind: "telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  // Payment card numbers (13-19 digits, optional grouping by spaces/dashes).
  { kind: "payment card", re: /\b(?:\d[ -]?){12,18}\d\b/ },
  // Long CVC-free numeric runs that look like bank account / credentials.
  { kind: "credentials", re: /\b(?:secret|credential)s?\s*[:=]\s*\S+/i },
];

/**
 * Return the first detected secret kind, or null when the content looks safe
 * to store. Deliberately conservative: false positives are acceptable here
 * because memory storage is non-critical; leaking secrets is not.
 */
export function detectSecret(content: string): SecretMatch | null {
  if (!content || content.trim().length === 0) return null;
  for (const { kind, re } of SECRET_PATTERNS) {
    if (re.test(content)) return { kind };
  }
  return null;
}

/** Short human-readable reason, for tool responses. */
export function secretReason(match: SecretMatch): string {
  return `Refusing to store content that looks like a ${match.kind}.`;
}
