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
import { takeSessionFile } from "../../../src/utils/session-files.js";
import coreAgent from "../core-agent/index.js";
import multiAgent from "../multi-agent/index.js";
import modelRouter from "../model-router/index.js";
import userRules from "../user-rules/index.js";
import gateway from "../gateway/index.js";
import reportGenerator from "../report-generator/index.js";
import approvalGate from "../approval-gate/index.js";
import commitmentTracking from "../commitment-tracking/index.js";
import voiceIntake from "../voice-intake/index.js";
import { clearSessionContext, setSessionContext } from "../user-rules/context.js";

/**
 * Inline extension for isolated Telegram sub-sessions: registers the provider
 * (with its API key) and activates the configured model from
 * `~/.grish-ai/config.json`. Runs on the sub-session's own `session_start`.
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
 * Extensions re-injected into each isolated sub-session. Everything Grisha
 * needs to behave like Grisha, except the telegram bot itself (would recurse)
 * and first-run-setup (wizard is not needed — providerBootstrap handles auth).
 */
const SUB_SESSION_EXTENSIONS: ExtensionFactory[] = [
  coreAgent,
  multiAgent,
  modelRouter,
  userRules,
  gateway,
  reportGenerator,
  approvalGate,
  commitmentTracking,
  voiceIntake,
  providerBootstrap,
];

/** Creates an isolated AgentSession for a Telegram user. */
export type TelegramSessionFactory = (userId: number) => Promise<AgentSession>;

export interface TelegramSessionPoolOptions {
  /** Working directory for the sub-sessions. Defaults to process.cwd(). */
  cwd?: string;
  /** Injectable factory for tests. Defaults to the real SDK-backed factory. */
  sessionFactory?: TelegramSessionFactory;
}

interface SessionEntry {
  sessionPromise: Promise<AgentSession>;
  queue: Promise<TelegramReply>;
}

/** Agent reply: text plus an optional generated file to send as a document. */
export interface TelegramReply {
  text: string;
  filePath?: string;
}

/**
 * One isolated AgentSession (its own sessionId + conversation history) per
 * Telegram user, with per-user message serialization.
 */
export class TelegramSessionPool {
  private readonly sessions = new Map<number, SessionEntry>();
  private readonly sessionFactory: TelegramSessionFactory;
  private readonly cwd: string;

  constructor(options: TelegramSessionPoolOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.sessionFactory = options.sessionFactory ?? ((userId) => this.createSession(userId));
  }

  private async createSession(userId: number): Promise<AgentSession> {
    const sessionsDir = path.join(getConfigDir(), "telegram", String(userId), "sessions");
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      extensionFactories: SUB_SESSION_EXTENSIONS,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      resourceLoader,
      sessionManager: SessionManager.create(this.cwd, sessionsDir),
      sessionStartEvent: { type: "session_start", reason: "startup" },
    });
    await session.bindExtensions({ mode: "json" });
    return session;
  }

  private getOrCreate(userId: number): SessionEntry {
    let entry = this.sessions.get(userId);
    if (!entry) {
      entry = {
        sessionPromise: this.sessionFactory(userId),
        queue: Promise.resolve({ text: "" }),
      };
      this.sessions.set(userId, entry);
    }
    return entry;
  }

  /** Number of currently pooled user sessions. */
  activeCount(): number {
    return this.sessions.size;
  }

  /** Telegram user ids with a currently pooled session (for admin status). */
  listActiveUserIds(): number[] {
    return [...this.sessions.keys()];
  }

  /**
   * Reset the isolated session for a user (`/new`). The current AgentSession
   * is disposed (its session files stay on disk — nothing is deleted), and a
   * fresh one with a new sessionId is created lazily on the next message.
   *
   * Only the conversation session is reset; cross-session state (personal
   * learning, user rules, memory) lives outside this pool and is untouched.
   */
  async reset(userId: number): Promise<void> {
    const entry = this.sessions.get(userId);
    if (!entry) return;
    this.sessions.delete(userId);
    const session = await entry.sessionPromise.catch(() => null);
    if (session) {
      session.dispose();
    }
  }

  /** Send a message to a user's isolated session and return Grisha's reply. */
  handleMessage(userId: number, chatId: string | undefined, message: string): Promise<TelegramReply> {
    const entry = this.getOrCreate(userId);
    const run = async (): Promise<TelegramReply> => {
      const session = await entry.sessionPromise;
      return this.runPrompt(session, chatId, String(userId), message);
    };
    entry.queue = entry.queue.then(run, run);
    return entry.queue;
  }

  private async runPrompt(
    session: AgentSession,
    chatId: string | undefined,
    userId: string,
    message: string,
  ): Promise<TelegramReply> {
    let settled = false;
    let resolveReply!: (value: TelegramReply) => void;
    const reply = new Promise<TelegramReply>((resolve) => {
      resolveReply = resolve;
    });

    const finish = (value: TelegramReply): void => {
      if (settled) return;
      settled = true;
      resolveReply(value);
    };

    const sessionId = session.sessionId;
    setSessionContext(sessionId, chatId ? { chatId, userId } : undefined);

    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "agent_end") return;
      unsubscribe();
      clearSessionContext(sessionId);
      const text = session.getLastAssistantText();
      // Pick up any file a tool registered for this session (report-generator).
      const filePath = takeSessionFile(sessionId);
      finish({ text: text && text.trim() ? text : "Гриша не ответил.", filePath });
    });

    try {
      await session.prompt(message, {
        source: "extension",
        ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
      });
    } catch {
      unsubscribe();
      clearSessionContext(sessionId);
      finish({ text: "Не удалось получить ответ от Гриши." });
    }

    return reply;
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of entries) {
      const session = await entry.sessionPromise.catch(() => null);
      if (session) {
        session.dispose();
      }
    }
  }
}
