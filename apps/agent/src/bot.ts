#!/usr/bin/env node
/**
 * Headless entry point: поднимает AgentSession с полным набором расширений
 * (как `pi`), но без TUI. Расширение telegram-bot стартует long polling на
 * событии session_start; first-run-setup применяет ~/.grish-ai/config.json.
 *
 * Запуск из apps/agent: node_modules/.bin/tsx src/bot.ts
 */
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";

const AGENT_CWD = process.cwd();

async function main(): Promise<void> {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd: AGENT_CWD, agentDir });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: AGENT_CWD,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.create(
      AGENT_CWD,
      path.join(getConfigDir(), "bot", "sessions"),
    ),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });

  await session.bindExtensions({ mode: "json" });

  console.log(
    "[bot] headless agent session ready; telegram-bot starts long polling on session_start",
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bot] received ${signal}, shutting down`);
    try {
      session.dispose();
    } catch (err) {
      console.error("[bot] dispose failed:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    console.error("[bot] uncaught exception:", err);
    try {
      session.dispose();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[bot] unhandled rejection:", reason);
  });

  // Safety keep-alive (long polling обычно сам держит event loop).
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error("[bot] startup failed:", err);
  process.exit(1);
});
