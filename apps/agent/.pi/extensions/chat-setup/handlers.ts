/**
 * Telegram-хендлеры онбординга: my_chat_member → safe_default + DM с кнопками;
 * callback cs:... → пресет/skip/custom/confirm/cancel; custom-текст в DM.
 * Логика пермишенов: canManage ИЛИ original addedByUserId.
 */
import type { InlineButton } from "../../../src/utils/telegram/session-files.js";
import type { ChatSetupService } from "./ChatSetupService.js";
import {
  buildConfirmKeyboard,
  buildOnboardingKeyboard,
  buildOnboardingText,
  describeRules,
  parseCustomRulesText,
  PRESETS,
  type PresetId,
} from "./RulePresets.js";

export interface MyChatMemberEvent {
  oldStatus: string;
  newStatus: string;
  chat: { id: number; type?: string; title?: string };
  from: { id: number };
}

export type SetupSendMessage = (
  chatId: number,
  text: string,
  extra?: { parseMode?: "HTML"; inlineButtons?: InlineButton[][] },
) => Promise<unknown>;

export interface SetupCallbackContext {
  from?: { id?: number };
  data?: string;
  answerCallbackQuery(text?: string, extra?: { showAlert?: boolean }): Promise<unknown>;
  editMessageText(text: string, extra?: { removeKeyboard?: boolean }): Promise<unknown>;
}

export interface SetupDeps {
  setup: ChatSetupService;
  users: { canManage(userId: string | number): Promise<boolean> };
  sendMessage: SetupSendMessage;
}

function wasAddedToChat(event: MyChatMemberEvent): boolean {
  const { oldStatus, newStatus } = event;
  return (
    (oldStatus === "left" || oldStatus === "kicked") &&
    (newStatus === "member" || newStatus === "administrator")
  );
}

/** §4: бота добавили в группу → safe_default + pending + DM (fallback в группу). */
export async function onChatMemberAdded(
  event: MyChatMemberEvent,
  deps: SetupDeps,
): Promise<void> {
  if (!wasAddedToChat(event)) return;
  if (event.chat.type === "private") return; // не для DM

  const chatId = String(event.chat.id);
  const actorId = String(event.from.id);
  const { setup } = deps;

  const existing = await setup.get(chatId);
  if (existing && (existing.status === "completed" || existing.status === "skipped")) {
    return; // не спамить онбордингом
  }

  // Safe defaults немедленно (hard rules чата), статус остаётся pending.
  await setup.applyPreset(chatId, "safe_default", { actorId, silent: true });
  await setup.markPending({
    chatId,
    chatTitle: event.chat.title,
    chatType: event.chat.type ?? "group",
    addedByUserId: actorId,
  });

  const title = event.chat.title ?? chatId;
  try {
    await deps.sendMessage(Number(actorId), buildOnboardingText(title), {
      parseMode: "HTML",
      inlineButtons: buildOnboardingKeyboard(chatId),
    });
  } catch {
    // R3: ОДИН короткий fallback в группу, без кнопок пресетов (кнопки — только в DM).
    // Это НЕ диалог с агентом и не снимает silent (R1 остаётся).
    try {
      await deps.sendMessage(
        Number(chatId),
        "Чтобы настроить меня для этой группы, откройте личный чат со мной, нажмите /start и отправьте /setup.",
      );
    } catch {
      /* ignore */
    }
  }
}

function parseCallback(data: string): { chatId: string; action: string; presetId?: string } | null {
  const parts = data.split(":");
  if (parts[0] !== "cs" || parts.length < 3) return null;
  const [, chatId, action, presetId] = parts;
  if (!chatId || !action) return null;
  return { chatId, action, presetId };
}

/** §8: обработка callback cs:... Возвращает true, если callback наш. */
export async function handleSetupCallback(
  data: string,
  ctx: SetupCallbackContext,
  deps: SetupDeps,
): Promise<boolean> {
  const parsed = parseCallback(data);
  if (!parsed) return false;
  const { chatId, action, presetId } = parsed;
  const actorId = String(ctx.from?.id ?? "");

  // Пермишн: canManage ИЛИ original addedByUserId.
  const rec = await deps.setup.get(chatId);
  const allowedByAcl = actorId ? await deps.users.canManage(actorId) : false;
  const isAdder = rec?.addedByUserId === actorId;
  if (!allowedByAcl && !isAdder) {
    await ctx.answerCallbackQuery("Недостаточно прав", { showAlert: true });
    return true;
  }

  if (action === "p" && presetId && presetId in PRESETS) {
    await deps.setup.applyPreset(chatId, presetId as PresetId, { actorId });
    await ctx.answerCallbackQuery("Применено");
    await ctx.editMessageText(
      `Готово. Режим «${PRESETS[presetId as PresetId].title}» для чата ${chatId}.`,
      { removeKeyboard: true },
    );
    return true;
  }

  if (action === "skip") {
    await deps.setup.markSkipped(chatId);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageText("Оставил безопасный режим (только @mention / reply).", {
      removeKeyboard: true,
    });
    return true;
  }

  if (action === "custom") {
    await deps.setup.beginCustom(chatId, actorId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "Опишите одним сообщением, как мне работать в этой группе.\n" +
        "Например: «Отвечай только на мои сообщения, кратко и по делу».\n\n" +
        "Я покажу, как понял правила, и попрошу подтверждение.",
      { removeKeyboard: true },
    );
    return true;
  }

  if (action === "confirm") {
    await deps.setup.confirmCustom(chatId, actorId);
    await ctx.answerCallbackQuery("Применено");
    await ctx.editMessageText(`Готово. Пользовательские правила для чата ${chatId} применены.`, {
      removeKeyboard: true,
    });
    return true;
  }

  if (action === "cancel") {
    await deps.setup.cancelCustom(chatId);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageText("Отменил. Остаётся безопасный режим (только @mention / reply).", {
      removeKeyboard: true,
    });
    return true;
  }

  return true;
}

/** §8.1: custom-текст в DM (waitingCustom) → parse + кнопки подтверждения. */
export async function tryHandleCustomText(
  input: { userId: string; chatId: string; text: string; isPrivate: boolean },
  deps: { setup: ChatSetupService },
  send: (chatId: number, text: string, extra?: { inlineButtons?: InlineButton[][] }) => Promise<void>,
): Promise<boolean> {
  if (!input.isPrivate) return false;
  const rec = await deps.setup.getWaitingForActor(input.userId);
  if (!rec) return false;

  const rules = parseCustomRulesText(input.text, input.userId);
  await deps.setup.setPendingRules(rec.chatId, rules);
  await send(Number(input.chatId), describeRules(rules), {
    inlineButtons: buildConfirmKeyboard(rec.chatId),
  });
  return true;
}

/** §11 (D5): /setup — DM-only, пересылает keyboard пресетов. */
export async function runSetupCommand(
  args: string,
  ctx: { chatId: string; userId: string; isPrivate: boolean },
  deps: {
    setup: ChatSetupService;
    users: { canManage(userId: string | number): Promise<boolean> };
    sendMessage: SetupSendMessage;
  },
): Promise<string> {
  if (!ctx.isPrivate) {
    return "Настройка групп — только в личных сообщениях с ботом. Откройте DM и отправьте /setup.";
  }
  if (!(await deps.users.canManage(ctx.userId))) {
    return "Недостаточно прав. Нужна роль owner или admin.";
  }

  const arg = args.trim();
  const pending = (await deps.setup.list()).filter((c) => c.status === "pending");

  if (arg) {
    const chatId = arg.split(/\s+/)[0];
    const rec = await deps.setup.get(chatId);
    if (!rec || rec.status !== "pending") {
      return `Чат ${chatId} не в статусе pending.`;
    }
    const title = rec.chatTitle ?? chatId;
    await deps.sendMessage(Number(ctx.userId), buildOnboardingText(title), {
      parseMode: "HTML",
      inlineButtons: buildOnboardingKeyboard(chatId),
    });
    return `Отправил меню настройки для «${title}».`;
  }

  if (pending.length === 0) return "Нет групп, ожидающих настройки.";

  // Отправляем keyboard'ы (лимит 5 — не спамить).
  const batch = pending.slice(0, 5);
  for (const c of batch) {
    await deps.sendMessage(Number(ctx.userId), buildOnboardingText(c.chatTitle ?? c.chatId), {
      parseMode: "HTML",
      inlineButtons: buildOnboardingKeyboard(c.chatId),
    });
  }
  return (
    `Групп в ожидании: ${pending.length}. Меню отправил в этот чат` +
    (pending.length > 5 ? ` (первые 5). Остальные: /setup <chatId>` : ".")
  );
}
