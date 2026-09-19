/**
 * groups.ts — DM-оркестратор групп (S6): /groups (список) и /group <chatId>
 * (карточка с кнопками сценарий/архив/активировать).
 *
 * Только DM + canManage/owner. Клавиатуры НЕ постим в группы (R-GR-2).
 */
import type { InlineButton } from "../../../src/utils/telegram/session-files.js";
import type { ChatSetupService } from "./ChatSetupService.js";
import type { ChatSetupRecord } from "./types.js";
import { getScenario } from "../scenarios/registry.js";

export interface GroupsDeps {
  setup: ChatSetupService;
  users: { canManage(userId: string | number): Promise<boolean> };
}

export type GroupsSendMessage = (
  chatId: number,
  text: string,
  extra?: { inlineButtons?: InlineButton[][] },
) => Promise<unknown>;

export interface GroupsCallbackContext {
  from?: { id?: number };
  data?: string;
  answerCallbackQuery(text?: string, extra?: { showAlert?: boolean }): Promise<unknown>;
  editMessageText(text: string, extra?: { removeKeyboard?: boolean }): Promise<unknown>;
}

const DENIED = "Нет доступа. Нужна роль owner или admin.";

function fmtStatus(status: string): string {
  switch (status) {
    case "active":
      return "активна";
    case "archived":
      return "в архиве";
    case "pending":
      return "ожидает настройки";
    default:
      return status;
  }
}

function buildGroupCard(rec: ChatSetupRecord): string {
  const title = rec.chatTitle ?? rec.chatId;
  const scenario = rec.scenario ? `Сценарий: ${rec.scenario}` : "Сценарий: —";
  const preset = rec.presetId ? `Пресет: ${rec.presetId}` : "Пресет: —";
  const lastSeen = rec.lastSeenAt ? `\nlastSeen: ${rec.lastSeenAt.slice(0, 10)}` : "";
  return `${title} (${rec.chatId})\nСтатус: ${fmtStatus(rec.status)}\n${scenario}\n${preset}${lastSeen}`;
}

/** Кнопки карточки группы: g:{chatId}:{action}. */
function buildGroupKeyboard(chatId: string): InlineButton[][] {
  return [
    [{ text: "Сценарий Секретарь", callbackData: `g:${chatId}:scenario` }],
    [{ text: "В архив", callbackData: `g:${chatId}:archive` }],
    [{ text: "Активировать", callbackData: `g:${chatId}:activate` }],
  ];
}

/**
 * /groups [<chatId>] — DM-only, canManage. Без аргумента — список;
 * с аргументом — карточка чата с кнопками (шлётся через send).
 */
export async function runGroupsCommand(
  args: string,
  ctx: { chatId: string; userId: string; isPrivate: boolean },
  deps: GroupsDeps,
  send: GroupsSendMessage,
): Promise<string> {
  if (!ctx.isPrivate) {
    return "Управление группами — только в личных сообщениях с ботом.";
  }
  if (!(await deps.users.canManage(ctx.userId))) {
    return DENIED;
  }

  const arg = args.trim();
  if (arg) {
    const chatId = arg.split(/\s+/)[0];
    const rec = await deps.setup.get(chatId);
    if (!rec) return `Чат ${chatId} не найден.`;
    await send(Number(ctx.chatId), buildGroupCard(rec), {
      inlineButtons: buildGroupKeyboard(chatId),
    });
    return `Карточка для чата ${chatId}.`;
  }

  const chats = await deps.setup.list();
  if (chats.length === 0) return "Нет настроенных групп.";
  const lines = chats.map((c) => {
    const title = c.chatTitle ?? c.chatId;
    const scenario = c.scenario ? ` [${c.scenario}]` : "";
    const lastSeen = c.lastSeenAt ? ` lastSeen=${c.lastSeenAt.slice(0, 10)}` : "";
    return `- ${title} (${c.chatId}) ${fmtStatus(c.status)}${scenario}${lastSeen}`;
  });
  return `Группы (${chats.length}):\n${lines.join("\n")}`;
}

/**
 * Callback g:{chatId}:{action}. Возвращает true, если callback наш.
 * DM-only (по определению inline-кнопки только в DM), guard canManage.
 */
export async function handleGroupCallback(
  data: string,
  ctx: GroupsCallbackContext,
  deps: GroupsDeps,
): Promise<boolean> {
  const parts = data.split(":");
  if (parts[0] !== "g" || parts.length < 3) return false;
  const [, chatId, action] = parts;
  const actorId = String(ctx.from?.id ?? "");
  if (!actorId) {
    await ctx.answerCallbackQuery("Недоступно.", { showAlert: true });
    return true;
  }
  if (!(await deps.users.canManage(actorId))) {
    await ctx.answerCallbackQuery(DENIED, { showAlert: true });
    return true;
  }

  if (action === "scenario") {
    const scenario = getScenario("secretary");
    await deps.setup.applyScenario(chatId, "secretary", { actorId });
    await ctx.answerCallbackQuery("Применено");
    await ctx.editMessageText(
      `Сценарий «${scenario?.title ?? "тихий секретарь"}» для чата ${chatId}.`,
      { removeKeyboard: true },
    );
  } else if (action === "archive") {
    await deps.setup.markArchived(chatId);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageText(`Чат ${chatId} переведён в архив.`, { removeKeyboard: true });
  } else if (action === "activate") {
    await deps.setup.reactivateFromArchived(chatId);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageText(`Чат ${chatId} активирован.`, { removeKeyboard: true });
  } else {
    await ctx.answerCallbackQuery("Неизвестное действие.", { showAlert: true });
  }
  return true;
}
