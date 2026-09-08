import { Hono } from "hono";
import { requireAuth } from "../auth.js";
import type { AgentStatusProvider } from "../types.js";

const EMPTY_PROVIDER: AgentStatusProvider = {
  getStatus: async () => ({ telegramBotRunning: false, activeTelegramSessions: 0, cronJobs: 0 }),
  listTelegramSessions: async () => [],
};

/**
 * Minimal admin endpoints: agent status + active Telegram sessions. Data comes
 * from an injected provider (the agent process wires TelegramSessionPool /
 * CronService / TelegramBotController); standalone the API reports zeros.
 */
export function admin(provider: AgentStatusProvider = EMPTY_PROVIDER, apiKey?: string): Hono {
  const app = new Hono();
  app.use("*", requireAuth(apiKey));

  app.get("/status", async (c) => c.json(await provider.getStatus()));
  app.get("/telegram/sessions", async (c) =>
    c.json({ sessions: await provider.listTelegramSessions() }),
  );

  return app;
}
