import { Hono } from "hono";
import { health } from "./routes/health.js";

export function createApp() {
  const app = new Hono();
  app.route("/health", health);
  // app.route("/transcribe", transcribe) — later
  return app;
}

// Optional local serve.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: createApp().fetch, port: Number(process.env.PORT) || 8787 });
}
