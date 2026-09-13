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
import { applyConfig } from "../../../src/utils/bootstrap/provider-bootstrap.js";
import { takeSessionFileRecord, takeSessionInlineButtons, type InlineButton } from "../../../src/utils/telegram/session-files.js";
import coreAgent from "../core-agent/index.js";
import multiAgent from "../multi-agent/index.js";
import modelRouter from "../model-router/index.js";
import userRules from "../user-rules/index.js";
import gateway from "../gateway/index.js";
import reportGenerator from "../report-generator/index.js";
import approvalGate from "../approval-gate/index.js";
import commitmentTracking from "../commitment-tracking/index.js";
import voiceIntake from "../voice-intake/index.js";
import proactiveAssistant from "../proactive-assistant/index.js";
import financeExtension from "../finance/index.js";
import crmExtension from "../crm/index.js";
import travelExtension from "../travel/index.js";
import connector from "../connector/index.js";
import telegramFileSend from "../telegram-file-send/index.js";
import documents from "../documents/index.js";
import groupMemory from "../group-memory/index.js";
import { clearSessionContext, setSessionContext } from "../user-rules/context.js";
import { sanitizeDirSegment } from "./session-key.js";

/**
 * Inline extension for isolated Telegram sub-sessions: registers the provider
 * (with its API key) and activates the configured model from
 * `~/.grish-ai/config.json`. Runs on the sub-session's own `session_start`.
 */
function providerBootstrap(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const cfg = loadConfig();
    if (!cfg) {
      console.warn("[telegram-bot] sub-session: no config found — model not configured");
      return;
    }
    try {
      const ok = await applyConfig(pi, ctx, cfg);
      console.log(`[telegram-bot] sub-session model bootstrap: ${ok ? "ok" : "FAILED"}`);
    } catch (err) {
      console.error("[telegram-bot] sub-session model bootstrap error:", err);
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
  proactiveAssistant,
  financeExtension,
  crmExtension,
  travelExtension,
  connector,
  telegramFileSend,
  documents,
  groupMemory,
  providerBootstrap,
];

/** Creates an isolated AgentSession for a Telegram session key (D2). */
export type TelegramSessionFactory = (
  sessionKey: string,
  userId: number,
  meta: TelegramSessionMeta,
) => Promise<AgentSession>;

/** Контекст сессии: чат + тема форума (+ rulesContext хода для агента). */
export interface TelegramSessionMeta {
  chatId?: string;
  threadId?: string;
  /** R-GR-3: контекст правил чата, передаётся в prompt на КАЖДЫЙ ход. */
  rulesContext?: string;
}

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

/** Agent reply: text plus an optional generated file and inline keyboard. */
export interface TelegramReply {
  text: string;
  filePath?: string;
  /** Telegram caption for the generated document. */
  documentCaption?: string;
  /** Inline keyboard rows (e.g. approval buttons queued by tools this turn). */
  inlineButtons?: InlineButton[][];
}

/**
 * Одна изолированная AgentSession (свой sessionId + история) на session key:
 * `tg:{userId}:{chatId}[:t:{threadId}]` — DM/группы/темы не смешиваются (D2).
 * Сериализация сообщений — по ключу.
 */
export class TelegramSessionPool {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly sessionFactory: TelegramSessionFactory;
  private readonly cwd: string;

  constructor(options: TelegramSessionPoolOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.sessionFactory =
      options.sessionFactory ??
      ((sessionKey, userId, meta) => this.createSession(sessionKey, userId, meta));
  }

  private async createSession(
    sessionKey: string,
    userId: number,
    meta: TelegramSessionMeta,
  ): Promise<AgentSession> {
    // D2: сессии на диске разведены по чатам/темам.
    const sessionsDir = path.join(
      getConfigDir(),
      "telegram",
      String(userId),
      "chats",
      sanitizeDirSegment(meta.chatId ?? "dm"),
      meta.threadId ? `t-${sanitizeDirSegment(meta.threadId)}` : "main",
      "sessions",
    );
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

  private getOrCreate(
    sessionKey: string,
    userId: number,
    meta: TelegramSessionMeta,
  ): SessionEntry {
    let entry = this.sessions.get(sessionKey);
    if (!entry) {
      entry = {
        sessionPromise: this.sessionFactory(sessionKey, userId, meta),
        queue: Promise.resolve({ text: "" }),
      };
      this.sessions.set(sessionKey, entry);
    }
    return entry;
  }

  /** Number of currently pooled sessions. */
  activeCount(): number {
    return this.sessions.size;
  }

  /** Session keys с активной сессией (для admin status). */
  listActiveSessionKeys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Reset сессии по ключу (`/new` в конкретном чате/теме). Текущий AgentSession
   * закрывается (файлы сессии остаются на диске), новый создаётся лениво.
   * Другие чаты пользователя НЕ затрагиваются (D2).
   */
  async reset(sessionKey: string): Promise<void> {
    const entry = this.sessions.get(sessionKey);
    if (!entry) return;
    this.sessions.delete(sessionKey);
    const session = await entry.sessionPromise.catch(() => null);
    if (session) {
      session.dispose();
    }
  }

  /** Send a message into a session key and return Grisha's reply. */
  handleMessage(
    sessionKey: string,
    userId: number,
    message: string,
    meta: TelegramSessionMeta = {},
  ): Promise<TelegramReply> {
    const entry = this.getOrCreate(sessionKey, userId, meta);
    const run = async (): Promise<TelegramReply> => {
      const session = await entry.sessionPromise;
      return this.runPrompt(session, meta.chatId, String(userId), message, meta.threadId, meta.rulesContext);
    };
    entry.queue = entry.queue.then(run, run);
    return entry.queue;
  }

  private async runPrompt(
    session: AgentSession,
    chatId: string | undefined,
    userId: string,
    message: string,
    threadId?: string,
    rulesContext?: string,
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
    setSessionContext(sessionId, chatId ? { chatId, userId, threadId } : undefined);

    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "agent_end") return;
      unsubscribe();
      clearSessionContext(sessionId);
      const text = session.getLastAssistantText();
      // Pick up any file a tool registered for this session (report-generator)
      // plus inline buttons (approval-gate) queued during the turn.
      const file = takeSessionFileRecord(sessionId);
      const inlineButtons = takeSessionInlineButtons(sessionId);
      finish({
        text: text && text.trim() ? text : "Гриша не ответил.",
        filePath: file?.filePath,
        documentCaption: file?.caption,
        inlineButtons,
      });
    });

    try {
      // R-GR-3: rulesContext — явный per-turn префикс (не только первый ход).
      const fullMessage = rulesContext ? `${rulesContext}\n\n${message}` : message;
      await session.prompt(fullMessage, {
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
