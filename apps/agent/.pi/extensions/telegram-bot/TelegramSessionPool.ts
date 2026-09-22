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
import obsTools from "../obs-tools/index.js";
import systemUpdate from "../system-update/index.js";
import { clearSessionContext, setSessionContext } from "../user-rules/context.js";
import { buildTelegramCorrelationId, logTelegramError, logTelegramEvent } from "./telegram-diagnostics.js";
import { sanitizeDirSegment } from "./session-key.js";
import { preparePoolRouting, type PoolRoutingResult } from "./pool-routing.js";
import { flashDepsFromConfig } from "./pool-call-flash.js";
import { applyBudgetToModel } from "./pool-apply-budget.js";
import {
  emit,
  emitGenerationBudget,
  emitGenerationFinish,
  emitTurnEnd,
  emitTurnStart,
} from "@griha/observability";

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
  obsTools,
  systemUpdate,
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
  /** P4: update_id входящего сообщения (для correlation id). */
  updateId?: number;
  /** R-GR-3: контекст правил чата, передаётся в prompt на КАЖДЫЙ ход. */
  rulesContext?: string;
  /** Phase 2.1: маршрутизация (hasImage/hasVoice/chatType для RoutingContext). */
  hasImage?: boolean;
  hasVoice?: boolean;
  chatType?: string;
}

export interface TelegramSessionPoolOptions {
  /** Working directory for the sub-sessions. Defaults to process.cwd(). */
  cwd?: string;
  /** Injectable factory for tests. Defaults to the real SDK-backed factory. */
  sessionFactory?: TelegramSessionFactory;
  /**
   * PROMPT 2: watchdog одного агентского хода (мс). Ход = LLM-цикл + tool-calls,
   * поэтому дефолт больше воркерных таймаутов проекта (delegation 120s, MCP 30s).
   */
  promptTimeoutMs?: number;
}

/** PROMPT 2: watchdog хода агента (5 минут). Больше воркерных таймаутов проекта. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;

/** PROMPT 2: ответ при срабатывании watchdog (не раскрывает причину пользователю). */
export const PROMPT_TIMEOUT_MESSAGE =
  "Гриша слишком долго отвечал. Попробуйте отправить сообщение ещё раз.";

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
  private readonly promptTimeoutMs: number;
  /** P4: fallback-последовательность correlation id (когда нет update_id). */
  private turnCounter = 0;

  constructor(options: TelegramSessionPoolOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
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
   * Reset сессии по ключу (`/new` в конкретном чате/теме).
   *
   * PROMPT 3: lifecycle protocol без гонок (drain-then-dispose):
   *   1. Entry отцепляется от пула СИНХРОННО (до первого await): новые
   *      операции для старой entry больше не принимаются — следующее
   *      сообщение создаст НОВУЮ entry/сессию.
   *   2. Ждём terminal state ВСЕХ принятых операций (`entry.queue`): начатая
   *      работа завершается, queued-ходы выполняются на ещё живой сессии.
   *      Watchdog (PROMPT 2) гарантирует settle каждого хода — зависания нет.
   *   3. Только после этого — dispose: старый run больше не обращается к
   *      runtime. НЕ глобальный лок: queue персональная у sessionKey, другие
   *      чаты/темы не затрагиваются (D2).
   *
   * Файлы сессии остаются на диске; новый AgentSession создаётся лениво.
   */
  async reset(sessionKey: string): Promise<void> {
    const entry = this.sessions.get(sessionKey);
    if (!entry) return;
    // 1) Отцепляем entry от пула до любого await (4: новая session независимо).
    this.sessions.delete(sessionKey);
    // 2) Terminal state всех принятых операций (2, 7). Chain не отвергается
    //    в штатном режиме; на случай сбоя factory — не роняем /new.
    await entry.queue.catch((err: unknown) => {
      // PROMPT 4: rejection очереди (сбой factory/хода) не теряется.
      logTelegramError({
        operation: "reset",
        stage: "drain",
        error: err,
        detail: sessionKey,
      });
    });
    // 3) Dispose только после полного drain (3, 5).
    const session = await entry.sessionPromise.catch((err: unknown) => {
      logTelegramError({
        operation: "reset",
        stage: "session_create",
        error: err,
        detail: sessionKey,
      });
      return null;
    });
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
      return this.runPrompt(session, meta.chatId, String(userId), message, meta.threadId, meta.updateId, meta.rulesContext, meta.hasImage, meta.hasVoice, meta.chatType);
    };
    entry.queue = entry.queue.then(run, run);
    return entry.queue;
  }

  /**
   * PROMPT 2: terminal state machine хода.
   *
   *   START → RUNNING
   *     ├── agent_end      → SUCCESS
   *     ├── prompt error   → ERROR
   *     └── watchdog       → TIMEOUT
   *
   * Каждый terminal state выполняет cleanup ровно один раз (settled-guard):
   * unsubscribe от событий, сброс таймера, очистка session context, finish
   * ровно один раз — очередь при этом всегда освобождается.
   */
  private async runPrompt(
    session: AgentSession,
    chatId: string | undefined,
    userId: string,
    message: string,
    threadId?: string,
    updateId?: number,
    rulesContext?: string,
    hasImage?: boolean,
    hasVoice?: boolean,
    chatType?: string,
  ): Promise<TelegramReply> {
    let settled = false;
    let resolveReply!: (value: TelegramReply) => void;
    const reply = new Promise<TelegramReply>((resolve) => {
      resolveReply = resolve;
    });

    // Phase 2.3: модель для восстановления после apply budget (STRATEGY B).
    let modelToRestore: Parameters<AgentSession["setModel"]>[0] | undefined;
    let budgetApplyStrategy: "set_model" | "none" = "none";
    // Obs v2: terminal status хода (для turn.end / generation.finish).
    let turnOk = true;
    let turnCode = "ok";

    // Объявлены до finish, чтобы cleanup не падал по TDZ.
    let unsubscribe: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sessionId = session.sessionId;
    // P4: correlation id хода (та же формула, что в outcome-трассе бриджа).
    const correlationId = buildTelegramCorrelationId(
      chatId ?? "unknown",
      updateId,
      ++this.turnCounter,
    );
    const startedAt = Date.now();
    const baseEvent = { correlationId, chatId, threadId, updateId, userId, sessionId } as const;
    // P5: per-tool duration_ms (toolCallId → время старта).
    const toolStartedAt = new Map<string, number>();

    const finish = (value: TelegramReply): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe();
      clearSessionContext(sessionId);
      // Phase 2.3: восстановить модель после prompt (fire-and-forget).
      if (modelToRestore) {
        const restore = modelToRestore;
        modelToRestore = undefined;
        session.setModel(restore).catch(() => {});
      }
      // Obs v2: terminal state — один turn.end + generation.finish.
      emitTurnEnd({
        correlationId,
        chatId,
        threadId,
        userId,
        updateId,
        sessionKey: sessionId,
        ok: turnOk,
        code: turnCode,
        durationMs: Date.now() - startedAt,
        data: { hadReply: !!(value.text && value.text.trim()), hadFile: !!value.filePath },
      });
      emitGenerationFinish({
        correlationId,
        chatId,
        sessionKey: sessionId,
        ok: turnOk,
        code: turnOk ? "unknown" : "error",
        data: { usageAvailable: false },
      });
      resolveReply(value);
    };

    setSessionContext(sessionId, chatId ? { chatId, userId, threadId, updateId, correlationId } : undefined);

    logTelegramEvent({ event: "session.prompt.started", ...baseEvent });

    // Obs v2: turn.start (тот же correlationId до turn.end).
    emitTurnStart({
      correlationId,
      chatId,
      threadId,
      userId,
      updateId,
      sessionKey: sessionId,
      data: { chatType, hasImage: !!hasImage, hasVoice: !!hasVoice, textLen: message.length },
    });

    unsubscribe = session.subscribe((event) => {
      // P5: per-tool duration_ms. args/result НЕ логируются (содержимое).
      if (event.type === "tool_execution_start") {
        toolStartedAt.set(event.toolCallId, Date.now());
        return;
      }
      if (event.type === "tool_execution_end") {
        const toolStart = toolStartedAt.get(event.toolCallId);
        toolStartedAt.delete(event.toolCallId);
        logTelegramEvent({
          event: "tool.execution.completed",
          ...baseEvent,
          toolName: event.toolName,
          durationMs: toolStart !== undefined ? Date.now() - toolStart : undefined,
          status: event.isError ? "failed" : "ok",
        });
        return;
      }
      if (event.type !== "agent_end") return;
      const text = session.getLastAssistantText();
      // Pick up any file a tool registered for this session (report-generator)
      // plus inline buttons (approval-gate) queued during the turn.
      const file = takeSessionFileRecord(sessionId);
      const inlineButtons = takeSessionInlineButtons(sessionId);
      logTelegramEvent({
        event: "session.prompt.completed",
        ...baseEvent,
        durationMs: Date.now() - startedAt,
        status: "ok",
        artifactId: file?.dedupeKey,
      });
      finish({
        text: text && text.trim() ? text : "Гриша не ответил.",
        filePath: file?.filePath,
        documentCaption: file?.caption,
        inlineButtons,
      });
    });

    // PROMPT 2: watchdog — agent runtime не завершил lifecycle вовремя.
    timer = setTimeout(() => {
      // PROMPT 4: аномалия lifecycle фиксируется диагностикой.
      logTelegramError({
        operation: "agent_prompt",
        stage: "watchdog",
        sessionId,
        chatId,
        userId,
        threadId,
      });
      logTelegramEvent({
        event: "session.prompt.timeout",
        ...baseEvent,
        durationMs: Date.now() - startedAt,
        status: "timeout",
      });
      turnOk = false;
      turnCode = "timeout";
      finish({ text: PROMPT_TIMEOUT_MESSAGE });
    }, this.promptTimeoutMs);

    // Phase 2.1/2.2/2.3: маршрутизация + budget + apply на модель (fail-safe; флаги off → ноль накладных).
    let routed: PoolRoutingResult = { decision: null, budget: null };
    try {
      const cfg = loadConfig();
      routed = await preparePoolRouting(
        { text: message, hasImage, hasVoice, chatType },
        {
          env: process.env,
          flash: cfg ? flashDepsFromConfig(cfg) : undefined,
        },
      );
    } catch {
      // fail-safe: routing никогда не роняет ход
    }

    // Phase 2.3 (STRATEGY B): применить budget к модели (setModel → restore в finish).
    const previousModel = session.model;
    if (routed.budget && previousModel) {
      modelToRestore = previousModel;
      try {
        await session.setModel(applyBudgetToModel(previousModel, routed.budget));
        budgetApplyStrategy = "set_model";
      } catch {
        budgetApplyStrategy = "none";
      }
    }

    if (routed.decision) {
      logTelegramEvent({
        event: "routing.decision",
        ...baseEvent,
        role: routed.decision.role,
        complexity: routed.decision.complexity,
        kind: routed.decision.kind,
        confidence: routed.decision.confidence,
        source: routed.decision.source,
        reason: routed.decision.reason,
        flashCalled: routed.decision.source === "flash_llm",
        budgetApplied: budgetApplyStrategy === "set_model",
        budgetApplyStrategy,
        initialMaxTokens: routed.budget?.initialMaxTokens,
        policyVersion: routed.budget?.policyVersion,
      });
    }

    // Obs v2: routing.decision (emit) + generation.budget.
    if (routed.decision) {
      emit({
        level: "info",
        component: "runtime.routing",
        event: "routing.decision",
        correlationId,
        chatId,
        threadId,
        userId,
        sessionKey: sessionId,
        data: {
          role: routed.decision.role,
          complexity: routed.decision.complexity,
          kind: routed.decision.kind,
          confidence: routed.decision.confidence,
          source: routed.decision.source,
          reason: routed.decision.reason,
          flashCalled: routed.decision.source === "flash_llm",
        },
      });
    }
    if (routed.budget) {
      emitGenerationBudget({
        correlationId,
        chatId,
        sessionKey: sessionId,
        data: {
          policyVersion: routed.budget.policyVersion,
          complexity: routed.budget.complexity,
          kind: routed.budget.kind,
          initialMaxTokens: routed.budget.initialMaxTokens,
          softMaxTokens: routed.budget.softMaxTokens,
          hardMaxTokens: routed.budget.hardMaxTokens,
          temperature: routed.budget.temperature,
          budgetApplied: budgetApplyStrategy === "set_model",
          budgetApplyStrategy,
        },
      });
    }

    try {
      // R-GR-3: rulesContext — явный per-turn префикс (не только первый ход).
      const fullMessage = rulesContext ? `${rulesContext}\n\n${message}` : message;
      // ВАЖНО: не await зависшего prompt напрямую — иначе runPrompt (и очередь)
      // останутся pending после finish. Terminal state решает результат;
      // висящий prompt остаётся фоновым, его ошибка глушится settled-guard'ом.
      const promptPromise = session.prompt(fullMessage, {
        source: "extension",
        ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
      });
      promptPromise.catch((err: unknown) => {
        // PROMPT 4: ошибка хода — структурированная диагностика, без
        // пользовательского текста; пользователю — безопасное сообщение.
        logTelegramError({
          operation: "agent_prompt",
          stage: "prompt",
          sessionId,
          chatId,
          userId,
          threadId,
          error: err,
        });
        logTelegramEvent({
          event: "session.prompt.failed",
          ...baseEvent,
          durationMs: Date.now() - startedAt,
          status: "failed",
          reason: "prompt-error",
        });
        turnOk = false;
        turnCode = "prompt_error";
        finish({ text: "Не удалось получить ответ от Гриши." });
      });
    } catch (err) {
      // Синхронный throw session.prompt.
      logTelegramError({
        operation: "agent_prompt",
        stage: "prompt_sync",
        sessionId,
        chatId,
        userId,
        threadId,
        error: err,
      });
      logTelegramEvent({
        event: "session.prompt.failed",
        ...baseEvent,
        durationMs: Date.now() - startedAt,
        status: "failed",
        reason: "prompt-sync-error",
      });
      turnOk = false;
      turnCode = "prompt_error";
      finish({ text: "Не удалось получить ответ от Гриши." });
    }

    return reply;
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of entries) {
      const session = await entry.sessionPromise.catch((err: unknown) => {
        // PROMPT 4: сбой создания сессии при shutdown не теряется.
        logTelegramError({
          operation: "dispose_all",
          stage: "session_create",
          error: err,
        });
        return null;
      });
      if (session) {
        session.dispose();
      }
    }
  }
}
