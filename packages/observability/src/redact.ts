/** Красные-строки, похожие на Telegram bot token. */
const TOKEN_RE = /\d+:[A-Za-z0-9_-]{20,}/g;
/** Authorization: Bearer … */
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
/** Ключи, которые не должны попадать в лог. */
// "token" — но НЕ счётчики "tokens" (maxTokens/initialMaxTokens/outputTokens и т.п.).
const SENSITIVE_KEY_RE = /(password|token(?!s)|authorization|secret|api[-_]?key)/i;

export function redactString(s: string): string {
  let out = s.replace(TOKEN_RE, "[REDACTED_TOKEN]");
  out = out.replace(BEARER_RE, "[REDACTED_BEARER]");
  if (out.length > 500) out = out.slice(0, 500) + "…";
  return out;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  }
  return value;
}

export function redactData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return data;
  return walk(data) as Record<string, unknown>;
}
