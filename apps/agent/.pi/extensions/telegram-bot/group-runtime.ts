/**
 * Group Runtime Contract — единый конвейер входящего сообщения (R-GR-1…R-GR-6).
 *
 * prepareGroupTurn — синхронные шаги 2–4 (configured → правила → prefilter),
 * вызывается из каждого branch TelegramBridge перед агентом.
 * processInboundMessage — полная async-версия (ACL → подготовка → STT → агент
 * → ответ) для приватных/групповых путей; юнит-тестируется напрямую.
 *
 * Hard rules enforced in code (prefilter), не через LLM (R-GR-4).
 */
import type { UserRule } from "@griha/shared-types";
import { buildTelegramSessionKey } from "./session-key.js";
import { formatRulesContext } from "../user-rules/format-rules-context.js";
import type { evaluatePreFilter, RulePreFilterInput } from "../user-rules/prefilter.js";

export interface PrepareTurnInput {
  chatId: string;
  userId: string;
  threadId?: string;
  chatType: string; // private | group | supergroup | channel
  isGroup: boolean;
  isChannel?: boolean;
  text: string;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  startsWithOtherMention?: boolean;
  fromIsBot?: boolean;
  isService?: boolean;
  groupConfigured?: boolean;
  caption?: string;
  messageId?: number;
}

export interface PrepareTurnResult {
  process: boolean;
  reason?: string;
  /** Архивариус (listen_only): обработать, но не отвечать без @mention. */
  suppressReply: boolean;
  /** Архивариус: сохранить сообщение/медиа в chat_archive. */
  archive: boolean;
  /** Контекст правил чата для агента (R-GR-3) — передаётся каждый ход. */
  rulesContext: string;
}

export interface PrepareTurnDeps {
  isGroupConfigured: (chatId: string) => boolean;
  getHardRules: (chatId: string) => UserRule[];
  getSoftRules: (chatId: string) => UserRule[];
  /** Полная форма prefilter (process + suppressReply + archive). */
  evaluate: typeof evaluatePreFilter;
  formatRules: (hard: UserRule[], soft: UserRule[]) => string;
}

function blocked(
  reason: string,
  extra?: { archive?: boolean; suppressReply?: boolean },
): PrepareTurnResult {
  return {
    process: false,
    reason,
    suppressReply: extra?.suppressReply ?? false,
    archive: extra?.archive ?? false,
    rulesContext: "",
  };
}

export function prepareGroupTurn(input: PrepareTurnInput, deps: PrepareTurnDeps): PrepareTurnResult {
  // 2) R-GR-1: pending (group/supergroup/channel) — нулевой ответ (даже на @mention).
  if ((input.isGroup || input.isChannel === true) && !deps.isGroupConfigured(input.chatId)) {
    return blocked("group-not-configured");
  }

  // 3) R-GR-3: правила чата загружаются ДО вызова агента.
  const hard = deps.getHardRules(input.chatId);
  const soft = deps.getSoftRules(input.chatId);
  const rulesContext = deps.formatRules(hard, soft);

  // 4) R-GR-4: hard-правила — в коде (prefilter), не через LLM.
  const prefilterInput: RulePreFilterInput = {
    chatId: input.chatId,
    fromUserId: input.userId,
    text: input.text,
    isGroup: input.isGroup,
    isChannel: input.isChannel,
    groupConfigured: input.isGroup || input.isChannel === true ? true : undefined,
    botMentioned: input.botMentioned,
    repliedToBot: input.repliedToBot,
    startsWithOtherMention: input.startsWithOtherMention,
    fromIsBot: input.fromIsBot,
    isService: input.isService,
  };
  const gate = deps.evaluate(hard, prefilterInput);
  if (!gate.process) {
    // A1/L-A3: prefilter запретил агента, но archive/suppressReply НЕ теряются —
    // listener без mention должен тихо архивировать (process:false, archive:true).
    return blocked("prefilter", {
      archive: gate.archive === true,
      suppressReply: gate.suppressReply === true,
    });
  }

  return {
    process: true,
    suppressReply: gate.suppressReply,
    archive: gate.archive,
    rulesContext,
  };
}

// ── Полный async-конвейер (unit-тестируемая версия спецификации §2) ───────────

export interface PipelineContext extends PrepareTurnInput {
  voiceFileId?: string;
}

export type PipelineResult =
  | { action: "silent"; reason: string }
  | { action: "replied"; reason: string }
  | { action: "handled"; reason: string };

export interface PipelineDeps extends PrepareTurnDeps {
  isAllowed: (userId: string, chatId: string) => Promise<boolean>;
  transcribeVoice?: (fileId: string, meta: { chatId: string; userId: string }) => Promise<string>;
  runAgent: (input: {
    message: string;
    userId: number;
    chatId: string;
    threadId?: string;
    sessionKey: string;
    rulesContext: string;
  }) => Promise<{ text: string }>;
  send: (chatId: number, text: string, extra?: { threadId?: string }) => Promise<void>;
}

export async function processInboundMessage(
  ctx: PipelineContext,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  // 1) ACL.
  if (!(await deps.isAllowed(ctx.userId, ctx.chatId))) {
    return { action: "silent", reason: "acl-denied" };
  }

  const gate = prepareGroupTurn(ctx, deps);
  if (!gate.process) return { action: "silent", reason: gate.reason ?? "prefilter" };

  // 5) Голос → STT → текст (повторный prefilter по распознанному тексту).
  let messageText = ctx.text;
  if (ctx.voiceFileId && deps.transcribeVoice) {
    try {
      messageText = await deps.transcribeVoice(ctx.voiceFileId, {
        chatId: ctx.chatId,
        userId: ctx.userId,
      });
      if (!messageText.trim()) {
        await deps.send(Number(ctx.chatId), "Не удалось распознать голос.", {
          threadId: ctx.threadId,
        });
        return { action: "handled", reason: "stt-empty" };
      }
      const gate2 = prepareGroupTurn({ ...ctx, text: messageText }, deps);
      if (!gate2.process) return { action: "silent", reason: "prefilter-after-stt" };
    } catch {
      await deps.send(Number(ctx.chatId), "Не удалось распознать голос.", {
        threadId: ctx.threadId,
      });
      return { action: "handled", reason: "stt-failed" };
    }
  }

  // 6) Агент с rulesContext на КАЖДЫЙ ход + изолированный sessionKey (R-GR-5/6).
  const sessionKey = buildTelegramSessionKey({
    userId: ctx.userId,
    chatId: ctx.chatId,
    threadId: ctx.threadId,
  });
  const reply = await deps.runAgent({
    message: messageText,
    userId: Number(ctx.userId),
    chatId: ctx.chatId,
    threadId: ctx.threadId,
    sessionKey,
    rulesContext: gate.rulesContext,
  });

  if (gate.suppressReply) return { action: "handled", reason: "archived-silent" };
  await deps.send(Number(ctx.chatId), reply.text, { threadId: ctx.threadId });
  return { action: "replied", reason: "ok" };
}

/** R-GR-8: уведомлять о плохом OCR только при явном policy-флаге чата. */
export function shouldNotifyPoorOcr(
  rules: UserRule[],
  result: { needsReview?: boolean; confidence?: number },
  opts?: { defaultThreshold?: number },
): boolean {
  const threshold = opts?.defaultThreshold ?? 0.4;
  const flag = [...rules].reverse().find((r) => r.key === "notify_poor_ocr")?.value;
  if (flag !== true && flag !== "true") return false;
  const confidence = result.confidence ?? 0;
  if (result.needsReview === true || confidence < threshold) return true;
  return false;
}
