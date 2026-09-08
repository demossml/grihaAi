import type { MiddlewareHandler } from "hono";

/**
 * Minimal API-key guard. Accepts `Authorization: Bearer <key>` or
 * `X-API-Key: <key>`. When no key is configured, protected endpoints deny by
 * default (fail-closed).
 */
export function requireAuth(apiKey?: string): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) {
      return c.json({ ok: false, error: "API key is not configured" }, 401);
    }
    const auth = c.req.header("Authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    const provided = bearer ?? c.req.header("X-API-Key");
    if (provided !== apiKey) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
    await next();
  };
}
