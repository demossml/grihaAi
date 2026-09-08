import { Hono } from "hono";
import { transcribeVoice as defaultTranscribeVoice } from "@griha/stt";
import { requireAuth } from "../auth.js";
import type { CreateAppOptions } from "../types.js";

/**
 * POST /transcribe — HTTP wrapper over @griha/stt.transcribeVoice.
 * Body: `{ "filePath": "...", "language": "ru" }`.
 */
export function transcribe(
  transcribeFn: CreateAppOptions["transcribe"] = defaultTranscribeVoice,
  apiKey?: string,
): Hono {
  const app = new Hono();
  app.use("/", requireAuth(apiKey));

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { filePath?: string; language?: string }
      | null;
    if (!body?.filePath) {
      return c.json({ ok: false, error: "filePath is required" }, 400);
    }
    const result = await transcribeFn!(body.filePath, { language: body.language });
    return c.json(result, result.ok ? 200 : 422);
  });

  return app;
}
