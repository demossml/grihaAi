import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { getConfigDir, loadConfig } from "@griha/config";
import { applyConfig } from "../../../src/utils/provider-bootstrap.js";
import coreAgent from "../core-agent/index.js";
import modelRouter from "../model-router/index.js";
import userRules from "../user-rules/index.js";
import gateway from "../gateway/index.js";
import { setSessionTrust } from "../../../src/sandbox/gateway-context.js";
import type { SubAgentRunTask, SubAgentRunner } from "./SubAgentManager.js";

/**
 * Registers the provider (with its API key) and activates the configured model
 * on the sub-agent session. Mirrors `providerBootstrap` in the Telegram session
 * pool: a sub-session does not inherit the parent's runtime auth, so it must
 * re-apply `~/.grish-ai/config.json` on its own `session_start`.
 */
function providerBootstrap(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const cfg = loadConfig();
    if (cfg) {
      await applyConfig(pi, ctx, cfg);
    }
  });
}

/**
 * Extensions re-injected into each isolated sub-agent session. Everything
 * Grisha needs to behave like Grisha, except `multi-agent` itself — sub-agents
 * must not spawn further sub-agents (delegation depth is implicitly 1), so the
 * `delegate_tasks`/`check_subagents` tools are intentionally absent here.
 */
const SUB_AGENT_EXTENSIONS: ExtensionFactory[] = [
  coreAgent,
  modelRouter,
  userRules,
  gateway,
  providerBootstrap,
];

export interface RealSubAgentRunnerOptions {
  /** Working directory for sub-agent sessions. Defaults to process.cwd(). */
  cwd?: string;
  /** Injectable factory for tests. Defaults to the real SDK-backed factory. */
  sessionFactory?: (task: SubAgentRunTask) => Promise<AgentSession>;
}

/**
 * Real `SubAgentRunner`: runs each sub-agent task through an isolated
 * `AgentSession` (the same `createAgentSession` path the Telegram session pool
 * uses), scoped by `task.subtreeSessionId` so memory/history stay per-task.
 */
export function createRealSubAgentRunner(
  options: RealSubAgentRunnerOptions = {},
): SubAgentRunner {
  const cwd = options.cwd ?? process.cwd();
  const sessionFactory =
    options.sessionFactory ?? ((task: SubAgentRunTask) => createSession(cwd, task));

  return async (task) => {
    const session = await sessionFactory(task);

    // Redirects delivered by the manager land here (Phase 6 live steering).
    task.onSteer = (message: string) => {
      void session.steer(message).catch(() => {});
    };

    try {
      return await runPrompt(session, task);
    } finally {
      session.dispose();
    }
  };
}

async function createSession(cwd: string, task: SubAgentRunTask): Promise<AgentSession> {
  const sessionsDir = path.join(
    getConfigDir(),
    "subagents",
    task.subtreeSessionId,
    "sessions",
  );
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    extensionFactories: SUB_AGENT_EXTENSIONS,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    resourceLoader,
    sessionManager: SessionManager.create(cwd, sessionsDir),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  // Sub-agents run LLM-driven tool calls on untrusted input → mark untrusted so
  // the gateway blocks shell/file-mutation tools (defense-in-depth).
  setSessionTrust(session.sessionId, "untrusted");
  await session.bindExtensions({ mode: "json" });
  return session;
}

function runPrompt(
  session: AgentSession,
  task: SubAgentRunTask,
): Promise<{ result: string; insights?: string[] }> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (result: string): void => {
      if (settled) return;
      settled = true;
      task.signal.removeEventListener("abort", onAbort);
      unsubscribe?.();
      resolve({ result });
    };

    const onAbort = (): void => finish("");

    if (task.signal.aborted) {
      finish("");
      return;
    }
    task.signal.addEventListener("abort", onAbort, { once: true });

    unsubscribe = session.subscribe((event) => {
      if (event.type === "entry_appended" && event.entry.type === "message") {
        const message = event.entry.message;
        if (message.role === "assistant") {
          const text = (message.content as Array<{ type: string; text?: string }>)
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("");
          if (text) task.onPartial?.(text);
        }
      } else if (event.type === "agent_end" && !event.willRetry) {
        const text = session.getLastAssistantText();
        finish(text && text.trim() ? text.trim() : "Субагент не вернул результат.");
      }
    });

    const prompt = task.context
      ? `Context:\n${task.context}\n\nGoal:\n${task.goal}`
      : task.goal;

    session
      .prompt(prompt, {
        source: "extension",
        ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
      })
      .catch((error) => finish(error instanceof Error ? error.message : String(error)));
  });
}
