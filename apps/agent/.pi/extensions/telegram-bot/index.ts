import { Bot, InputFile } from "grammy";
import os from "node:os";
import path from "node:path";
import { buildBotOptions, resolveProxyUrl } from "./proxy.js";
import {
  sharedTelegramFetcher,
  startPeriodicIpRefresh,
} from "./telegram-network.js";
import {
  archiveFromTelegram,
  getChatArchiveService,
  getListenerMediaPipeline,
  processMediaRetryJob,
  setExpenseBriefNotifier,
} from "../../../src/services/documents/index.js";
import {
  MediaRetryQueue,
  isTransientMediaError,
  startMediaRetryWorker,
  type MediaRetryJob,
} from "../../../src/services/documents/media-retry.js";
import { getOcrRateLimiter } from "../../../src/services/documents/ocr-limiter.js";
import type { ListenerMediaResult } from "../../../src/services/documents/ListenerMediaPipeline.js";
import { downloadTelegramFileToDisk } from "../../../src/utils/telegram/telegram-files.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GrishaAgent, type ProcessMediaResult, type TgMessage } from "./TelegramBridge.js";
import {
  TelegramBotController,
  type TelegramBotFactory,
} from "./TelegramBotController.js";
import { TelegramSessionPool } from "./TelegramSessionPool.js";
import { loadConfig, saveConfig } from "@griha/config";
import { evaluatePreFilter } from "../user-rules/prefilter.js";
import { formatRulesContext } from "../user-rules/format-rules-context.js";
import { prepareGroupTurn, shouldNotifyPoorOcr } from "./group-runtime.js";
import { makeGuardedRulesHandler } from "./rules-auth.js";
import { incMetric, getTelegramMetrics } from "./metrics.js";
import { getTelegramPinApi } from "./pin-bridge.js";
import { getUserRulesService } from "../user-rules/UserRulesService.js";
import { recordChatPolicyFromRules, rulesToChatPolicy } from "../user-rules/chat-policy.js";
import { buildExtractionPrompt } from "../chat-setup/policy-extraction.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";
import { telegramRulesHandler } from "../user-rules/index.js";
import { applyApprovalDecision } from "../approval-gate/index.js";
import { getUsersService, resolveOwnerId } from "../../../src/services/UsersService.js";
import { formatExpenseBrief } from "../../../src/services/documents/groupHistoryTools.js";
import { handleUsersCommand } from "../../../src/services/users-command.js";
import {
  getChatSetupService,
} from "../chat-setup/ChatSetupService.js";
import {
  handleSetupCallback,
  onChatMemberAdded,
  runSetupCommand,
  tryHandleCustomText,
} from "../chat-setup/handlers.js";
import { presetRulesWithActor, presetMarkerKey, type PresetId } from "../chat-setup/RulePresets.js";
import { mapChatMemberStatus } from "./chat-auth.js";
import { setTelegramFileAclCheck } from "./file-send-bridge.js";
import { transcribeVoice } from "@griha/stt";

// Один раз на процесс: первичное обнаружение IP + периодическое (10 минут).
// Не должно повторяться на каждом реконнекте бота (иначе плодятся таймеры).
startPeriodicIpRefresh(sharedTelegramFetcher);
void sharedTelegramFetcher.refreshIps().catch(() => {});

// self-инфо бота (id/username) — для расчёта mention/reply флагов pre-filter'а.
let botSelf: { id: number; username?: string } | undefined;

/**
 * A2: self-инфо с ретраями (getMe может упасть на нестабильной сети).
 * Вызывается ДО обработки сообщений; env-fallback TELEGRAM_BOT_USERNAME,
 * если API не вернул username.
 */
async function ensureBotSelf(
  api: { getMe(): Promise<{ id: number; username?: string }> },
  maxAttempts = 5,
): Promise<{ id: number; username?: string } | undefined> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const me = await api.getMe();
      const username = me.username ?? process.env.TELEGRAM_BOT_USERNAME;
      console.log(`[telegram-bot] getMe ok: id=${me.id} username=${username ?? ""}`);
      return { id: me.id, username };
    } catch (err: unknown) {
      console.error(
        `[telegram-bot] getMe failed ${i}/${maxAttempts}`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  return undefined;
}

/**
 * Adapts the real grammy Bot to the framework-free `TelegramBotLike` surface.
 * Document delivery wraps the path in grammy's `InputFile` (a raw string would
 * be treated as a remote file_id, not a local file).
 *
 * Сеть: по умолчанию Telegram ходит напрямую через кастомную fetch поверх
 * node:https (DoH-обнаружение + мульти-IP sticky + keep-alive) — Telegram из РФ
 * блокируется по отдельным IP, поэтому один прокси с захардкоженным IP ненадёжен.
 * Legacy-путь через HTTPS_PROXY включается только TELEGRAM_USE_PROXY=1.
 */
const realBotFactory: TelegramBotFactory = (token) => {
  const proxyUrl = resolveProxyUrl();
  let bot: Bot;
  if (process.env.TELEGRAM_USE_PROXY === "1" && proxyUrl) {
    console.log("[telegram-bot] using HTTPS proxy for Telegram API (legacy TELEGRAM_USE_PROXY=1)");
    bot = new Bot(token, buildBotOptions(proxyUrl)!);
  } else {
    bot = new Bot(token, {
      // Типы fetch в grammy (node-fetch) и @types/node (undici) несовместимы
      // номинально; сигнатура нашей реализации соответствует им обоим.
      client: { fetch: sharedTelegramFetcher.fetch as never },
    });
  }
  return {
    on: (filter, handler) => {
      if (filter === "callback_query:data") {
        void bot.on("callback_query:data", (gctx) => {
          const cbq = gctx.callbackQuery;
          void handler({
            from: cbq?.from?.id != null ? { id: cbq.from.id } : undefined,
            data: cbq?.data,
            message: cbq?.message
              ? {
                  chat: cbq.message.chat?.id != null ? { id: cbq.message.chat.id } : undefined,
                  message_id: cbq.message.message_id,
                  text: cbq.message.text,
                }
              : undefined,
            answerCallbackQuery: (text, extra) =>
              gctx.answerCallbackQuery(text !== undefined ? { text, show_alert: extra?.showAlert } : {}),
            editMessageText: (text, extra) =>
              gctx.editMessageText(text, {
                // Исходное сообщение отправлялось как HTML — редактируем в том же режиме.
                parse_mode: "HTML",
                ...(extra?.removeKeyboard ? { reply_markup: { inline_keyboard: [] } } : {}),
              }),
          });
        });
        return;
      }
      void bot.on(filter, handler as never);
    },
    start: async () => {
      // A2: self-инфо для mention/reply-флагов — ДО обработки сообщений, с
      // ретраями (getMe на нестабильной сети). username логируется.
      if (!botSelf) {
        botSelf = await ensureBotSelf(bot.api);
      }
      // A4: явный список allowed_updates — не тянем ненужные update-типы.
      return bot.start({
        allowed_updates: [
          "message",
          "edited_message",
          "channel_post",
          "edited_channel_post",
          "callback_query",
          "my_chat_member",
          "chat_join_request",
        ],
      });
    },
    stop: () => bot.stop(),
    api: {
      sendMessage: (chatId, text, extra) =>
        bot.api.sendMessage(chatId, text, {
          ...(extra?.parseMode ? { parse_mode: extra.parseMode } : {}),
          ...(extra?.messageThreadId ? { message_thread_id: extra.messageThreadId } : {}),
          ...(extra?.inlineButtons
            ? {
                reply_markup: {
                  inline_keyboard: extra.inlineButtons.map((row) =>
                    row.map((button) => ({
                      text: button.text,
                      callback_data: button.callbackData,
                    })),
                  ),
                },
              }
            : {}),
        }),
      sendDocument: (chatId, filePath, extra) =>
        bot.api.sendDocument(chatId, new InputFile(filePath), {
          ...(extra?.caption ? { caption: extra.caption } : {}),
          ...(extra?.messageThreadId ? { message_thread_id: extra.messageThreadId } : {}),
        }),
      // G2: фото из локального файла (тот же InputFile-паттерн).
      sendPhoto: (chatId, filePath, extra) =>
        bot.api.sendPhoto(chatId, new InputFile(filePath), {
          ...(extra?.caption ? { caption: extra.caption } : {}),
          ...(extra?.messageThreadId ? { message_thread_id: extra.messageThreadId } : {}),
        }),
      sendChatAction: (chatId, action, extra) =>
        bot.api.sendChatAction(chatId, action, {
          ...(extra?.messageThreadId !== undefined
            ? { message_thread_id: extra.messageThreadId }
            : {}),
        }),
      setMyCommands: (commands) => bot.api.setMyCommands(commands),
      setMessageReaction: (chatId, messageId, reaction) =>
        // grammy типизирует emoji как литеральный union — здесь строка из бриджа.
        bot.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: reaction as never }]),
      getChatMember: (chatId, userId) => bot.api.getChatMember(chatId, userId),
      // G6: закрепить сообщение (тихо).
      pinChatMessage: (chatId, messageId) =>
        bot.api.pinChatMessage(chatId, messageId, { disable_notification: true }),
      // G7: заявки на вступление.
      approveChatJoinRequest: (chatId, userId) => bot.api.approveChatJoinRequest(chatId, userId),
      declineChatJoinRequest: (chatId, userId) => bot.api.declineChatJoinRequest(chatId, userId),
    },
  };
};

let controller: TelegramBotController | null = null;
let pool: TelegramSessionPool | null = null;

function grishaAgent(): GrishaAgent {
  return async (input) => {
    if (!pool) return { text: "Гриша временно недоступен." };
    // D2: пул ключуется sessionKey (чай/тема), не только userId.
    // R-GR-3: rulesContext передаётся в prompt на каждый ход.
    return pool.handleMessage(input.sessionKey, input.userId, input.message, {
      chatId: input.chatId,
      threadId: input.threadId,
      rulesContext: input.rulesContext,
    });
  };
}

// ── Media retry (R-GR-7): сбой скачивания не теряет file_id ───────────────────
let mediaRetry: MediaRetryQueue | null = null;
let stopMediaWorker: (() => void) | null = null;

function startMediaRetry(): void {
  if (stopMediaWorker) return;
  mediaRetry = new MediaRetryQueue();
  stopMediaWorker = startMediaRetryWorker({
    queue: mediaRetry,
    processJob: async (job: MediaRetryJob) => {
      // L6: ретрай выполняет ПОЛНЫЙ pipeline (OCR + archive + structured ingest),
      // не только сырой archive.
      await processMediaRetryJob(job, getListenerMediaPipeline());
    },
  });
}

function stopMediaRetry(): void {
  stopMediaWorker?.();
  stopMediaWorker = null;
  mediaRetry?.close();
  mediaRetry = null;
}

function getController(): TelegramBotController {
  if (!controller) {
    const cfg = loadConfig();
    // Users ACL: единственный сервис на процесс; входящие апдейты проверяются
    // по нему на каждый апдейт (disk store + cache, writes — без рестарта).
    const users = getUsersService();
    const setup = getChatSetupService();
    // ACL для инструмента send_file — тот же источник (UsersService).
    setTelegramFileAclCheck((userId, chatId) => users.isAllowed(userId, chatId));
    controller = new TelegramBotController(
      grishaAgent(),
      cfg?.telegram?.allowedUserIds ?? [],
      realBotFactory,
      {
        prefilter: (input) =>
          evaluatePreFilter(getUserRulesService().getHardRules(input.chatId), input),
        // Group Runtime Contract: единый конвейер configured → rules → prefilter
        // (R-GR-1/3/4) с rulesContext для каждого хода агента.
        prepareTurn: (input) =>
          prepareGroupTurn(input, {
            isGroupConfigured: (chatId) => setup.isConfiguredSync(chatId),
            getHardRules: (chatId) => getUserRulesService().getHardRules(chatId),
            getSoftRules: (chatId) => getUserRulesService().getSoftRules(chatId),
            evaluate: (rules, prefilterInput) => evaluatePreFilter(rules, prefilterInput),
            formatRules: (hard, soft) => formatRulesContext(hard, soft),
          }),
        rulesHandler: makeGuardedRulesHandler({
          run: (args, ctx) => telegramRulesHandler(args, ctx),
          users,
        }),
        resetHandler: (sessionKey) => pool?.reset(sessionKey),
        approvalHandler: (action, id) => applyApprovalDecision(action, id).message,
        aclCheck: (userId, chatId) => users.isAllowed(userId, chatId),
        // A1–A4: agent-ACL по membership (group) / явному списку (private).
        // getChatMember к текущему bot привязывает сам контроллер.
        telegramAccess: {
          isAllowedPrivate: (userId) => users.isAllowedPrivate(userId),
        },
        usersCommandHandler: (args, ctx) => handleUsersCommand(users, args, ctx),
        // Chat-setup (онбординг групп): my_chat_member → DM, cs:-callbacks,
        // custom-текст в DM, /setup с keyboard'ами (D5).
        chatMemberHandler: (event, deps) =>
          onChatMemberAdded(event, { setup, users, sendMessage: deps.sendMessage }),
        setupCallbackHandler: (data, ctx, deps) =>
          handleSetupCallback(data, ctx, {
            setup,
            users,
            sendMessage: async () => undefined,
            // Пакет B: статус actor в группе — из реального getChatMember.
            getChatMember: async (chatId, userId) =>
              mapChatMemberStatus((await deps.getChatMember(Number(chatId), Number(userId))).status),
          }),
        setupCommandHandler: (args, ctx, send, deps) =>
          runSetupCommand(args, ctx, {
            setup,
            users,
            sendMessage: async (chatId, text, extra) => {
              await send(chatId, text, undefined, extra);
            },
            getChatMember: async (chatId, userId) =>
              mapChatMemberStatus((await deps.getChatMember(Number(chatId), Number(userId))).status),
          }),
        pendingGroupsHint: async (userId) => {
          // D9: только группы, добавленные этим пользователем.
          const pending = (await setup.list()).filter(
            (c) => c.status === "pending" && c.addedByUserId === userId,
          );
          return pending.length > 0
            ? `\n\nЕсть группы без настройки: ${pending.length}. Отправьте /setup чтобы получить кнопки.`
            : "";
        },
        // D3: голос транскрибируется до агента (STT через @griha/stt).
        transcribeVoice: async (fileId) => {
          const token = loadConfig()?.telegram?.botToken;
          if (!token) throw new Error("STT not configured");
          const dest = path.join(
            os.tmpdir(),
            `griha-voice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          );
          const filePath = await downloadTelegramFileToDisk(token, fileId, dest);
          try {
            const result = await transcribeVoice(filePath, {});
            if (!result.ok || !result.text.trim()) throw new Error("empty transcription");
            return result.text;
          } finally {
            const fs = await import("node:fs/promises");
            await fs.rm(filePath, { force: true }).catch(() => undefined);
          }
        },
        customSetupInterceptor: (input, send) =>
          tryHandleCustomText(
            input,
            {
              setup,
              // PROMPT 06: LLM structured extraction (fallback — regex внутри).
              llmExtract: async (text) => {
                try {
                  const cfg = loadConfig();
                  if (!cfg) throw new Error("no config");
                  return await createHttpLearningLlm(cfg)(buildExtractionPrompt(text));
                } catch (err: unknown) {
                  console.warn(
                    "[telegram-bot] LLM policy extraction failed (regex fallback):",
                    err instanceof Error ? err.message : err,
                  );
                  throw err;
                }
              },
            },
            async (chatId, text, extra) => {
              await send(chatId, text, undefined, extra);
            },
          ),
        getBotSelf: () => botSelf,
        // R1: pending-группа silent (онбординг не завершён → prefilter false).
        getGroupConfigured: (chatId) => setup.isConfiguredSync(chatId),
        // Единый медиа-конвейер (photo/document/voice/video/audio): download →
        // OCR/STT → archive → expense. Одна точка для allowed-ходов (OCR до
        // агента) и фоновых путей (listener / archive_ocr_ingest).
        processMedia: async (msg, ctx) =>
          runMediaPipelineFor(msg, {
            chatId: ctx.chatId,
            userId: ctx.userId,
            kind: ctx.kind,
            allowed: ctx.allowed,
            archive: ctx.archive,
          }),
        // G1: альбом — каждый файл через тот же конвейер, один ответ агента.
        albumBufferMs: 1000,
        processMediaAlbum: async (batch, ctx) => {
          const results: ProcessMediaResult[] = [];
          for (const item of batch.items) {
            const res = await runMediaPipelineFor(
              item as unknown as TgMessage,
              {
                chatId: ctx.chatId,
                userId: ctx.userId,
                kind: item.kind,
                allowed: ctx.allowed,
                archive: ctx.archive,
              },
              { caption: item.caption, threadId: ctx.threadId, messageId: item.messageId },
            );
            if (res) results.push(res);
          }
          const combinedRawText = results
            .map((r, i) => (r.rawText ? `[файл ${i + 1}]\n${r.rawText}` : null))
            .filter(Boolean)
            .join("\n====\n");
          const lastExpense = [...results].reverse().find((r) => r.expenseId)?.expenseId;
          return {
            rawText: combinedRawText || undefined,
            confidence: results.length ? Math.max(...results.map((r) => r.confidence ?? 0)) : 0,
            expenseId: lastExpense,
            ingestedExpense: results.some((r) => r.ingestedExpense),
          };
        },
        // G6: /pin — canManage + права бота (can_pin_messages) проверяются здесь.
        pinHandler: async ({ chatId, userId, messageId }) => {
          if (messageId === undefined) return "Сделайте /pin как ответ (reply) на сообщение.";
          if (!(await users.canManage(userId))) return "Недостаточно прав (owner/admin).";
          const pin = getTelegramPinApi();
          if (!pin) return "Закрепление недоступно.";
          try {
            const ok = await pin(Number(chatId), Number(messageId));
            return ok ? "Сообщение закреплено." : "Не удалось закрепить сообщение.";
          } catch (err: unknown) {
            console.error("[telegram-bot] pin failed:", err instanceof Error ? err.message : err);
            return "Не удалось закрепить сообщение (проверьте права бота в чате).";
          }
        },
        // G11: /status — admin видит метрики.
        statusHandler: async (userId) => {
          if (!(await users.canManage(userId))) return "Гриша работает.";
          const metrics = getTelegramMetrics();
          const lines = Object.entries(metrics)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
          return `Гриша работает.\n\nМетрики:\n${lines || "(нет данных)"}`;
        },
        botUsername: botSelf?.username,
        // G7: заявка на вступление — по умолчанию ТОЛЬКО уведомление владельцу
        // (автоодобрение исключительно при явном правиле join_auto_approve).
        joinRequestHandler: async (event, deps) => {
          const chatId = String(event.chat.id);
          const userId = String(event.from.id);
          const rules = [
            ...getUserRulesService().getHardRules(chatId),
            ...getUserRulesService().getSoftRules(chatId),
          ];
          const autoApprove = [...rules].reverse().some(
            (r) => r.key === "join_auto_approve" && (r.value === true || r.value === "true"),
          );
          const allowed = await users.isAllowed(userId, chatId);
          const ownerId = resolveOwnerId(loadConfig());
          const title = event.chat.title ?? chatId;
          const who = `${event.from.firstName ?? "?"}${event.from.username ? ` (@${event.from.username})` : ""} id=${userId}`;
          if (autoApprove && allowed) {
            try {
              await deps.approve(Number(chatId), Number(userId));
              if (ownerId) {
                await deps.sendMessage(
                  Number(ownerId),
                  `Заявка ${who} в «${title}» одобрена автоматически (join_auto_approve).`,
                );
              }
            } catch (err: unknown) {
              console.error(
                "[telegram-bot] join auto-approve failed:",
                err instanceof Error ? err.message : err,
              );
            }
            return;
          }
          if (ownerId) {
            await deps
              .sendMessage(
                Number(ownerId),
                `Заявка на вступление: ${who} в чат «${title}». ` +
                  `Автоодобрение выключено (правило join_auto_approve).`,
              )
              .catch((err: unknown) =>
                console.error("[telegram-bot] join notify failed:", err instanceof Error ? err.message : err),
              );
          }
        },
        // Архивариус (listen_only): тихое сохранение ТЕКСТА (медиа — через processMedia).
        archiveHandler: async (msg, ctx) => {
          if (ctx.kind !== "text") return { stored: false };
          try {
            const svc = getChatArchiveService();
            const res = await archiveFromTelegram(
              msg as unknown as Parameters<typeof archiveFromTelegram>[0],
              { kind: "text" },
              svc,
              {
                download: async (fileId) => {
                  const token = loadConfig()?.telegram?.botToken;
                  if (!token) throw new Error("no botToken");
                  const dest = path.join(
                    os.tmpdir(),
                    `griha-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  );
                  return downloadTelegramFileToDisk(token, fileId, dest);
                },
              },
            );
            if (res.stored) incMetric("telegram_listener_archived");
            return { stored: res.stored };
          } catch (err: unknown) {
            console.error(
              "[telegram-bot] text archive failed:",
              err instanceof Error ? err.message : err,
            );
            return { stored: false };
          }
        },
      },
    );
  }
  return controller;
}

/**
 * Bootstrap ACL при старте: legacy-whitelist → role="user", owner из
 * config.ownerUserId/env GRISHA_OWNER_ID → role="owner" (не затирая поля).
 */
async function bootstrapUsers(): Promise<void> {
  const cfg = loadConfig();
  const users = getUsersService();
  await users.seedLegacyUsers(cfg?.telegram?.allowedUserIds);
  await users.ensureOwner(resolveOwnerId(cfg));
  // R1: hydrate chat-setup cache до старта long polling (isConfiguredSync).
  const setup = getChatSetupService();
  setup.loadSync();
  // Миграция/repair правил completed-чатов: если у пресета нет его маркерного
  // hard-правила в SQLite — перезаписать managed-правила пресетом (идемпотентно,
  // статус НЕ трогаем). A3.
  for (const rec of await setup.list()) {
    if (rec.status !== "completed" || !rec.presetId) continue;
    const presetId = rec.presetId as PresetId;
    const hard = getUserRulesService().getHardRules(rec.chatId);
    const marker = presetMarkerKey(presetId);
    if (!marker) continue;
    const needsRepair = !hard.some((r) => r.key === marker);
    if (!needsRepair) continue;
    const actorId = rec.addedByUserId ?? "system-repair";
    try {
      getUserRulesService().replaceChatManagedRules(
        rec.chatId,
        presetRulesWithActor(presetId, actorId),
        { source: `repair:${presetId}`, actorId },
      );
      recordChatPolicyFromRules(
        rec.chatId,
        [
          ...getUserRulesService().getHardRules(rec.chatId),
          ...getUserRulesService().getSoftRules(rec.chatId),
        ],
        { source: `repair:${presetId}`, actorId },
      );
      console.log(
        `[chat-setup] repaired preset rules for chatId=${rec.chatId} preset=${rec.presetId}`,
      );
    } catch (err: unknown) {
      console.error(
        `[chat-setup] repair failed for chat ${rec.chatId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // D3-repair: текстовое правило «ТОЛЬКО в PDF» → structured
  // report_attachment_only=true (один документ без сопроводительного текста).
  for (const rec of await setup.list()) {
    if (rec.status !== "completed" && rec.status !== "skipped") continue;
    const rules = [
      ...getUserRulesService().getHardRules(rec.chatId),
      ...getUserRulesService().getSoftRules(rec.chatId),
    ];
    const hasKey = rules.some((r) => r.key === "report_attachment_only");
    const textOnlyPdf = rules.some((r) =>
      /(?:только|только.{0,8}в)\s*pdf|отчёт.{0,10}только.{0,10}pdf|без\s+текста/i.test(r.text),
    );
    if (!hasKey && textOnlyPdf) {
      try {
        getUserRulesService().addStructuredRule({
          chatId: rec.chatId,
          key: "report_attachment_only",
          value: true,
          kind: "hard",
          source: "repair:report-only",
          actorId: rec.addedByUserId ?? "system-repair",
        });
        console.log(
          `[chat-setup] report_attachment_only=true для chatId=${rec.chatId} (текстовое правило «только PDF»)`,
        );
      } catch (err: unknown) {
        console.error(
          `[chat-setup] report-only repair failed for ${rec.chatId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // R1-repair: архивные ключи для archive-пресетов (секретарь/команда/магазин
  // копят чеки и без @). Дописываем ТОЛЬКО отсутствующие, status не трогаем.
  const ARCHIVE_KEYS_BY_PRESET: Record<string, string[]> = {
    listener: ["archive_media", "archive_ocr_ingest"],
    secretary: ["archive_media", "archive_ocr_ingest"],
    team: ["archive_media", "archive_ocr_ingest"],
    shop: ["archive_ocr_ingest"],
  };
  for (const rec of await setup.list()) {
    if (rec.status !== "completed" && rec.status !== "skipped") continue;
    const keys = rec.presetId ? ARCHIVE_KEYS_BY_PRESET[rec.presetId] : undefined;
    if (!keys?.length) continue;
    const existing = new Set(getUserRulesService().getHardRules(rec.chatId).map((r) => r.key));
    for (const key of keys) {
      if (existing.has(key)) continue;
      try {
        getUserRulesService().addStructuredRule({
          chatId: rec.chatId,
          key,
          value: true,
          kind: "hard",
          source: `repair:${rec.presetId}`,
          actorId: rec.addedByUserId ?? "system-repair",
        });
        console.log(
          `[chat-setup] R1-repair: ${key}=true для chatId=${rec.chatId} preset=${rec.presetId}`,
        );
      } catch (err: unknown) {
        console.error(
          `[chat-setup] R1 archive repair failed for ${rec.chatId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

async function startBot(): Promise<boolean> {
  const token = loadConfig()?.telegram?.botToken;
  if (!token) {
    console.warn("[telegram-bot] startBot: no botToken configured");
    return false;
  }
  try {
    await bootstrapUsers();
    getController().start(token);
    wireExpenseBriefNotify(getController());
    // R-GR-7: фоновый воркер ретраев медиа — с ботом стартует/останавливается.
    startMediaRetry();
    return true;
  } catch (err: unknown) {
    console.error("[telegram-bot] startBot error:", err);
    return false;
  }
}

/**
 * §4: тихий брифинг по распознанному чеку. Только при правиле
 * notify_expense_brief=true в чате; получатель — addedByUserId настройки чата
 * или owner бота (DM). Сбой отправки молча игнорируется (не спамим в группу).
 */
function wireExpenseBriefNotify(ctl: TelegramBotController): void {
  setExpenseBriefNotifier(async (info) => {
    try {
      const rules = [
        ...getUserRulesService().getHardRules(info.chatId),
        ...getUserRulesService().getSoftRules(info.chatId),
      ];
      const enabled = [...rules].reverse().some(
        (r) => r.key === "notify_expense_brief" && (r.value === true || r.value === "true"),
      );
      if (!enabled) return;
      const rec = await getChatSetupService().get(info.chatId);
      const owner = resolveOwnerId(loadConfig());
      const addedBy =
        rec?.addedByUserId && rec.addedByUserId !== "0" ? rec.addedByUserId : undefined;
      const recipient = addedBy ?? (owner ? String(owner) : undefined);
      if (!recipient) return;
      await ctl.sendNotify(Number(recipient), formatExpenseBrief(info));
    } catch (err: unknown) {
      console.error(
        "[telegram-bot] expense brief failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });
}

async function stopBot(): Promise<void> {
  await controller?.stop();
  stopMediaRetry();
}

/** file_id/file_unique_id из фото (самый большой размер), документа или медиа. */
function mediaFileOf(
  msg: {
    photo?: Array<{ file_id?: string; file_unique_id?: string }>;
    document?: { file_id?: string; file_unique_id?: string };
    voice?: { file_id?: string; file_unique_id?: string };
    video?: { file_id?: string; file_unique_id?: string };
    videoNote?: { file_id?: string; file_unique_id?: string };
    audio?: { file_id?: string; file_unique_id?: string };
  },
): { fileId: string; fileUniqueId?: string } | null {
  if (msg.photo && msg.photo.length > 0) {
    const last = msg.photo[msg.photo.length - 1];
    if (last.file_id) return { fileId: last.file_id, fileUniqueId: last.file_unique_id };
  }
  if (msg.document?.file_id) {
    return { fileId: msg.document.file_id, fileUniqueId: msg.document.file_unique_id };
  }
  if (msg.voice?.file_id) {
    return { fileId: msg.voice.file_id, fileUniqueId: msg.voice.file_unique_id };
  }
  if (msg.video?.file_id) {
    return { fileId: msg.video.file_id, fileUniqueId: msg.video.file_unique_id };
  }
  if (msg.videoNote?.file_id) {
    return { fileId: msg.videoNote.file_id, fileUniqueId: msg.videoNote.file_unique_id };
  }
  if (msg.audio?.file_id) {
    return { fileId: msg.audio.file_id, fileUniqueId: msg.audio.file_unique_id };
  }
  return null;
}

/**
 * Единый запуск медиа-конвейера для photo/document/voice/video/video_note/audio
 * с policy-решениями и G3-рейт-лимитом. Используется и одиночными media-updates,
 * и элементами альбома (G1).
 */
async function runMediaPipelineFor(
  msg: TgMessage,
  ctx: {
    chatId: string;
    userId: string;
    kind: "photo" | "document" | "voice" | "video" | "video_note" | "audio";
    allowed: boolean;
    archive: boolean;
  },
  overrides?: { caption?: string; threadId?: string; messageId?: number },
): Promise<ProcessMediaResult | null> {
  const svc = getUserRulesService();
  const rules = [...svc.getHardRules(ctx.chatId), ...svc.getSoftRules(ctx.chatId)];
  const ruleStr = (key: string): string | undefined => {
    const v = [...rules].reverse().find((r) => r.key === key)?.value;
    return typeof v === "string" ? v : undefined;
  };
  const ingestMode = ruleStr("ingest_mode") ?? "mention";
  const policy = rulesToChatPolicy(rules);

  const kindArchive =
    ctx.kind === "photo"
      ? policy.archive.photo
      : ctx.kind === "document"
        ? policy.archive.document
        : ctx.kind === "voice" || ctx.kind === "audio" || ctx.kind === "video_note" || ctx.kind === "video"
          ? policy.archive.voice
          : false;
  const kindProcess =
    ctx.kind === "photo"
      ? policy.processing.photoOcr
      : ctx.kind === "document"
        ? policy.processing.documentOcr
        : policy.processing.voiceStt;

  const caption = overrides?.caption ?? msg.caption;
  const mentioned = msg.botMentioned === true || msg.repliedToBot === true;
  const captionHint = /(чек|накладн|invoice|receipt|расход)/i.test(caption ?? "");
  const mentionIngest =
    ingestMode === "always" || (ingestMode === "mention" && (mentioned || captionHint));

  if (!ctx.allowed && !ctx.archive && !kindArchive && !kindProcess && !mentionIngest) {
    return { skipped: true };
  }

  // G3: per-chat rate limit — без vision/STT-вызова при превышении лимита.
  const limiter = getOcrRateLimiter();
  const rateOk = limiter.allow(ctx.chatId, policy.processing.maxOcrPerHour);

  const doArchive = ctx.archive || kindArchive;
  const doOcrIngest = kindProcess || mentionIngest;

  try {
    const result = await getListenerMediaPipeline().process(
      {
        chatId: ctx.chatId,
        threadId: overrides?.threadId ?? msg.threadId,
        messageId:
          overrides?.messageId !== undefined
            ? String(overrides.messageId)
            : msg.messageId !== undefined
              ? String(msg.messageId)
              : undefined,
        fromUserId: msg.from?.id !== undefined ? String(msg.from.id) : undefined,
        caption,
        botMentioned: msg.botMentioned,
        repliedToBot: msg.repliedToBot,
        isEdited: msg.isEdited === true,
        photo: msg.photo as Array<{ file_id: string; file_unique_id?: string }> | undefined,
        document: msg.document as {
          file_id: string;
          file_unique_id?: string;
          file_name?: string;
          mime_type?: string;
        } | undefined,
        voice: msg.voice as
          | { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string }
          | undefined,
        video: msg.video as
          | { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string }
          | undefined,
        video_note: msg.videoNote as { file_id: string; file_unique_id?: string; duration?: number } | undefined,
        audio: msg.audio as
          | { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string; file_name?: string }
          | undefined,
      },
      {
        archive: doArchive,
        ocrIngest: doOcrIngest,
        skipExtraction: !rateOk,
        ocrMinBytes: policy.processing.minFileSizeBytes,
        ocrMaxBytes: policy.processing.maxFileSizeBytes,
        skipOcrIfNoHint: policy.processing.skipIfNoDocumentHint,
      },
    );
    incMetric("telegram_media_total");
    if (result.archived && !ctx.allowed) incMetric("telegram_listener_archived");
    if (result.needsReview) {
      if (ctx.kind === "voice" || ctx.kind === "audio" || ctx.kind === "video_note") {
        incMetric("telegram_stt_failed");
      } else if (ctx.kind === "photo" || ctx.kind === "document") {
        incMetric("telegram_ocr_failed");
      }
    }
    incMetric("telegram_media_processed");
    console.log(
      `[telegram-bot] media done chat=${ctx.chatId} kind=${ctx.kind} msg_id=${msg.messageId ?? "-"} ` +
        `status=${rateOk ? "processed" : "rate-limited"} archived=${result.archived} expense=${result.ingestedExpense} confidence=${result.confidence.toFixed(2)}`,
    );
    const notify =
      result.needsReview &&
      shouldNotifyPoorOcr(rules, {
        needsReview: result.needsReview,
        confidence: result.confidence,
      })
        ? "Не удалось уверенно распознать документ. Пришлите, пожалуйста, более чёткое фото."
        : undefined;
    return {
      rawText: result.rawText,
      confidence: result.confidence,
      expenseId: result.expenseId,
      ingestedExpense: result.ingestedExpense,
      notify,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const media = mediaFileOf(msg);
    if (media && mediaRetry && isTransientMediaError(message)) {
      await mediaRetry.enqueue({
        chatId: ctx.chatId,
        threadId: overrides?.threadId ?? msg.threadId,
        messageId: overrides?.messageId ?? msg.messageId,
        fileId: media.fileId,
        fileUniqueId: media.fileUniqueId,
        kind: ctx.kind,
      });
    }
    console.error("[telegram-bot] media pipeline failed (enqueued retry):", message);
    incMetric("telegram_media_failed");
    console.error(
      `[telegram-bot] media failed chat=${ctx.chatId} kind=${ctx.kind} msg_id=${msg.messageId ?? "-"} status=failed error=${message}`,
    );
    return { failed: true };
  }
}

export default function telegramBot(pi: ExtensionAPI): void {
  pool = new TelegramSessionPool();

  pi.on("session_start", () => {
    void startBot();
  });

  pi.on("session_shutdown", async () => {
    await stopBot();
    await pool?.disposeAll();
    pool = null;
    controller = null;
  });

  pi.on("before_agent_start", async (event) => {
    const configured = Boolean(loadConfig()?.telegram?.botToken);
    const note = [
      "## Telegram-бот (long polling)",
      configured
        ? "Встроенный Telegram-бот активен. Команды: /telegram-setup (перенастройка), /telegram-status (статус), /telegram-stop, /telegram-start."
        : "Встроенный Telegram-бот есть, но не настроен. Чтобы включить: получить токен у @BotFather и выполнить /telegram-setup.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${note}` };
  });

  pi.registerCommand("telegram-setup", {
    description: "Set up the Telegram bot (token + allowed users)",
    async handler(_args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify("Telegram setup needs interactive mode.", "error");
        return;
      }
      const cfg = loadConfig();
      if (!cfg) {
        ctx.ui.notify("No config found — run /setup first.", "error");
        return;
      }

      const token = await ctx.ui.input("Telegram bot token:", "");
      if (!token?.trim()) return;

      const usersRaw = await ctx.ui.input("Allowed user ids (comma-separated, optional):", "");
      const allowed = (usersRaw ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);

      cfg.telegram = { botToken: token.trim(), allowedUserIds: allowed };
      saveConfig(cfg);

      await stopBot();
      controller = null;
      await startBot();

      ctx.ui.notify("Telegram bot configured (long polling).", "info");
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Show Telegram bot status",
    async handler() {
      const tg = loadConfig()?.telegram;
      const running = controller?.isRunning() ?? false;
      const text = !tg
        ? "Telegram bot не настроен. Используй /telegram-setup."
        : `Token: ${tg.botToken ? "set" : "missing"}\nAllowed users: ${tg.allowedUserIds?.length ?? 0}\nRunning: ${running ? "да (long polling)" : "нет"}\nActive user sessions: ${pool?.activeCount() ?? 0}`;
      pi.sendMessage({
        customType: "telegram-status",
        content: [{ type: "text", text }],
        display: true,
      });
    },
  });

  pi.registerCommand("telegram-start", {
    description: "Start Telegram long polling",
    async handler() {
      const started = await startBot();
      pi.sendMessage({
        customType: "telegram-start",
        content: [
          {
            type: "text",
            text: started
              ? "Telegram bot started (long polling)."
              : "No bot token configured — run /telegram-setup.",
          },
        ],
        display: true,
      });
    },
  });

  pi.registerCommand("telegram-stop", {
    description: "Stop Telegram long polling",
    async handler() {
      await stopBot();
      pi.sendMessage({
        customType: "telegram-stop",
        content: [{ type: "text", text: "Telegram bot stopped." }],
        display: true,
      });
    },
  });
}
