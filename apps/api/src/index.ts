import { Hono } from "hono";
import { loadConfig } from "@griha/config";
import { health } from "./routes/health.js";
import { transcribe } from "./routes/transcribe.js";
import { admin } from "./routes/admin.js";
import type { CreateAppOptions } from "./types.js";

export { type AgentStatusProvider, type CreateAppOptions } from "./types.js";

export function createApp(options: CreateAppOptions = {}): Hono {
  // Only consult the saved config when the caller did not pass `apiKey`
  // explicitly (an explicit `undefined` means "no key" for tests).
  const apiKey = "apiKey" in options ? options.apiKey : loadConfig()?.adminApiKey;

  const app = new Hono();
  app.route("/health", health);
  app.route("/transcribe", transcribe(options.transcribe, apiKey));
  app.route("/admin", admin(options.statusProvider, apiKey));
  return app;
}

// Optional local serve.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: createApp().fetch, port: Number(process.env.PORT) || 8787 });
}
