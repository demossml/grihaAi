import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./index.js";
import type { AgentStatusProvider } from "./types.js";

const KEY = "test-admin-key";

function request(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  options: { key?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.key !== undefined) headers["X-API-Key"] = options.key;
  return app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("griha-api", () => {
  it("serves /health without auth", async () => {
    const res = await createApp().request("/health");
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; service: string };
    assert.equal(json.ok, true);
    assert.equal(json.service, "griha-api");
  });

  it("denies /transcribe without a key", async () => {
    const res = await request(createApp({ apiKey: undefined }), "POST", "/transcribe", {
      body: { filePath: "/tmp/x.wav" },
    });
    assert.equal(res.status, 401);
  });

  it("denies /transcribe with a wrong key", async () => {
    const res = await request(createApp({ apiKey: KEY }), "POST", "/transcribe", {
      key: "nope",
      body: { filePath: "/tmp/x.wav" },
    });
    assert.equal(res.status, 401);
  });

  it("proxies /transcribe to the injected STT bridge", async () => {
    let seen: { filePath: string; language?: string } | null = null;
    const app = createApp({
      apiKey: KEY,
      transcribe: async (filePath, options) => {
        seen = { filePath, language: options?.language };
        return { ok: true, text: "привет", language: "ru" };
      },
    });

    const res = await request(app, "POST", "/transcribe", {
      key: KEY,
      body: { filePath: "/tmp/voice.ogg", language: "ru" },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(seen, { filePath: "/tmp/voice.ogg", language: "ru" });
    const json = (await res.json()) as { ok: boolean; text: string };
    assert.equal(json.text, "привет");
  });

  it("maps a failed transcription to 422", async () => {
    const app = createApp({
      apiKey: KEY,
      transcribe: async () => ({ ok: false, text: "", error: "bad audio" }),
    });
    const res = await request(app, "POST", "/transcribe", {
      key: KEY,
      body: { filePath: "/tmp/x.wav" },
    });
    assert.equal(res.status, 422);
  });

  it("rejects /transcribe without filePath", async () => {
    const res = await request(createApp({ apiKey: KEY }), "POST", "/transcribe", {
      key: KEY,
      body: { language: "ru" },
    });
    assert.equal(res.status, 400);
  });

  it("serves /admin/status from the injected provider", async () => {
    const provider: AgentStatusProvider = {
      getStatus: async () => ({
        telegramBotRunning: true,
        activeTelegramSessions: 3,
        cronJobs: 5,
      }),
      listTelegramSessions: async () => [],
    };
    const res = await request(createApp({ apiKey: KEY, statusProvider: provider }), "GET", "/admin/status", {
      key: KEY,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { telegramBotRunning: boolean; activeTelegramSessions: number; cronJobs: number };
    assert.equal(json.telegramBotRunning, true);
    assert.equal(json.activeTelegramSessions, 3);
    assert.equal(json.cronJobs, 5);
  });

  it("serves /admin/telegram/sessions", async () => {
    const provider: AgentStatusProvider = {
      getStatus: async () => ({ telegramBotRunning: true, activeTelegramSessions: 1, cronJobs: 0 }),
      listTelegramSessions: async () => [{ userId: "123", sessionKey: "tg:123" }],
    };
    const res = await request(createApp({ apiKey: KEY, statusProvider: provider }), "GET", "/admin/telegram/sessions", {
      key: KEY,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { sessions: Array<{ userId: string; sessionKey: string }> };
    assert.deepEqual(json.sessions, [{ userId: "123", sessionKey: "tg:123" }]);
  });

  it("denies /admin/status without a key", async () => {
    const res = await request(createApp({ apiKey: undefined }), "GET", "/admin/status");
    assert.equal(res.status, 401);
  });
});
