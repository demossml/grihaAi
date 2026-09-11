/**
 * Единая нормализация Telegram update'ов (PROMPT 02):
 *   message | channel_post | edited_message | edited_channel_post
 * → одна модель NormalizedTelegramUpdate для bridge/pipeline.
 *
 * Безопасный sender: `from` (user) и `sender_chat` (канал/группа-отправитель)
 * разведены — `from` в channel_post может отсутствовать, никогда не делаем
 * `message.from!.id`.
 */
import { normalizeThreadId } from "./threads.js";
import { collectMentionFlags, type MentionEntity } from "./mentions.js";

export type TelegramChatKind = "private" | "group" | "supergroup" | "channel";

export type TelegramUpdateKind =
  | "message"
  | "channel_post"
  | "edited_message"
  | "edited_channel_post";

export type TelegramContentKind =
  | "text"
  | "photo"
  | "document"
  | "voice"
  | "contact"
  | "location"
  | "other";

export interface NormalizedSender {
  /** Обычный пользователь (в channel_post отсутствует). */
  userId?: string;
  /** sender_chat (канал/группа, от имени которой пришёл post). */
  senderChatId?: string;
  senderChatTitle?: string;
  displayName?: string;
  username?: string;
  isBot?: boolean;
}

export interface NormalizedChat {
  id: string;
  type: TelegramChatKind;
  title?: string;
  username?: string;
  isForum?: boolean;
}

export interface NormalizedMessage {
  id: string;
  /** Тема форума: message_thread_id ?? reply_to_message.message_thread_id. */
  threadId?: string;
  isEdited: boolean;
  editDate?: number;

  sender?: NormalizedSender;
  contentKind: TelegramContentKind;

  text?: string;
  caption?: string;

  /** Универсальный файл: photo (самый большой размер), document или voice. */
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  voiceDuration?: number;

  /** Сырые структуры (для pipeline/archive, сохранение всех размеров photo). */
  photo?: Array<{ file_id?: string; file_unique_id?: string }>;
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  voice?: { file_id?: string; file_unique_id?: string; duration?: number; mime_type?: string; file_size?: number };

  contact?: { first_name?: string; last_name?: string; phone_number?: string };
  location?: { latitude?: number; longitude?: number };

  isService?: boolean;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  startsWithOtherMention?: boolean;
}

export interface NormalizedTelegramUpdate {
  updateId: number;
  updateKind: TelegramUpdateKind;
  chat: NormalizedChat;
  message: NormalizedMessage;
}

export interface NormalizerDeps {
  botSelf?: { id: number; username?: string };
}

interface RawMessageLike {
  from?: { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
  sender_chat?: { id?: number; title?: string; username?: string; type?: string };
  chat?: { id?: number; type?: string; title?: string; username?: string; is_forum?: boolean };
  message_id?: number;
  message_thread_id?: number;
  reply_to_message?: { from?: { id?: number }; message_thread_id?: number };
  edit_date?: number;
  text?: string;
  caption?: string;
  entities?: MentionEntity[];
  caption_entities?: MentionEntity[];
  voice?: { file_id?: string; file_unique_id?: string; duration?: number; mime_type?: string; file_size?: number };
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  photo?: Array<{ file_id?: string; file_unique_id?: string; file_size?: number }>;
  contact?: { first_name?: string; last_name?: string; phone_number?: string };
  location?: { latitude?: number; longitude?: number };
  new_chat_members?: unknown;
  left_chat_member?: unknown;
  new_chat_title?: unknown;
  new_chat_photo?: unknown;
  delete_chat_photo?: unknown;
  group_chat_created?: unknown;
  supergroup_chat_created?: unknown;
  channel_chat_created?: unknown;
  pinned_message?: unknown;
  migrate_to_chat_id?: unknown;
}

interface RawContext {
  update?: { update_id?: number };
  message?: RawMessageLike;
  channel_post?: RawMessageLike;
  edited_message?: RawMessageLike;
  edited_channel_post?: RawMessageLike;
}

/** Достать сырое сообщение любого поддерживаемого update kind. */
export function rawMessageOf(ctx: unknown): {
  kind: TelegramUpdateKind;
  raw: RawMessageLike;
} | null {
  if (!ctx || typeof ctx !== "object") return null;
  const c = ctx as RawContext;
  if (c.message) return { kind: "message", raw: c.message };
  if (c.channel_post) return { kind: "channel_post", raw: c.channel_post };
  if (c.edited_message) return { kind: "edited_message", raw: c.edited_message };
  if (c.edited_channel_post) return { kind: "edited_channel_post", raw: c.edited_channel_post };
  return null;
}

/** Единое определение content kind (photo > document > voice > contact > location > text). */
export function contentKindOf(m: RawMessageLike): TelegramContentKind {
  if (m.photo && m.photo.length > 0) return "photo";
  if (m.document) return "document";
  if (m.voice) return "voice";
  if (m.contact) return "contact";
  if (m.location) return "location";
  if (typeof m.text === "string" && m.text.length > 0) return "text";
  if (typeof m.caption === "string" && m.caption.length > 0) return "text";
  return "other";
}

function isServiceMessage(m: RawMessageLike): boolean {
  return [
    m.new_chat_members,
    m.left_chat_member,
    m.new_chat_title,
    m.new_chat_photo,
    m.delete_chat_photo,
    m.group_chat_created,
    m.supergroup_chat_created,
    m.channel_chat_created,
    m.pinned_message,
    m.migrate_to_chat_id,
  ].some((f) => f !== undefined);
}

/** Служебное chat type → канонический kind. */
export function normalizeChatType(type: string | undefined): TelegramChatKind {
  switch (type) {
    case "group":
    case "supergroup":
    case "channel":
      return type;
    default:
      return "private";
  }
}

export function isManagedChatType(type: TelegramChatKind): boolean {
  return type === "group" || type === "supergroup" || type === "channel";
}

/**
 * Построить нормализованную модель update. Для channel_post/edited_* читает
 * соответствующие поля; sender разведён на user/sender_chat; topics — единая
 * логика (message_thread_id ?? reply_to_message.message_thread_id).
 */
export function normalizeTelegramUpdate(
  ctx: unknown,
  deps: NormalizerDeps = {},
): NormalizedTelegramUpdate | null {
  const found = rawMessageOf(ctx);
  if (!found) return null;
  const { kind, raw: m } = found;
  if (!m.chat?.id) return null;

  const chatType = normalizeChatType(m.chat.type);
  const self = deps.botSelf;
  const threadId = normalizeThreadId(m.message_thread_id ?? m.reply_to_message?.message_thread_id);

  // ── Pre-filter флаги (structured rules §9): mention/reply/bot/service. ──
  const textOrCaption = m.text ?? m.caption ?? "";
  const fromText = collectMentionFlags(textOrCaption, m.entities ?? [], self);
  const fromCaption = collectMentionFlags(m.caption ?? "", m.caption_entities ?? [], self);
  const botMentioned =
    fromText.botMentioned || fromCaption.botMentioned ? true : undefined;
  const startsWithOtherMention =
    fromText.startsWithOtherMention || fromCaption.startsWithOtherMention ? true : undefined;
  const replyFromId = m.reply_to_message?.from?.id;
  const repliedToBot =
    self && replyFromId !== undefined ? replyFromId === self.id : undefined;

  const contentKind = contentKindOf(m);

  // Универсальный файл: photo — самый большой размер (последний в массиве
  // Telegram API), document/voice — как есть.
  let telegramFileId: string | undefined;
  let telegramFileUniqueId: string | undefined;
  let mimeType: string | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let voiceDuration: number | undefined;
  if (contentKind === "photo") {
    const last = m.photo![m.photo!.length - 1];
    telegramFileId = last?.file_id;
    telegramFileUniqueId = last?.file_unique_id;
    mimeType = "image/jpeg";
  } else if (contentKind === "document") {
    telegramFileId = m.document?.file_id;
    telegramFileUniqueId = m.document?.file_unique_id;
    mimeType = m.document?.mime_type;
    fileName = m.document?.file_name;
    fileSize = m.document?.file_size;
  } else if (contentKind === "voice") {
    telegramFileId = m.voice?.file_id;
    telegramFileUniqueId = m.voice?.file_unique_id;
    mimeType = m.voice?.mime_type;
    fileSize = m.voice?.file_size;
    voiceDuration = m.voice?.duration;
  }

  const sender: NormalizedSender | undefined = m.from || m.sender_chat
    ? {
        userId: m.from?.id !== undefined ? String(m.from.id) : undefined,
        senderChatId: m.sender_chat?.id !== undefined ? String(m.sender_chat.id) : undefined,
        senderChatTitle: m.sender_chat?.title,
        displayName: m.from
          ? [m.from.first_name, m.from.last_name].filter(Boolean).join(" ").trim() || undefined
          : m.sender_chat?.title,
        username: m.from?.username ?? m.sender_chat?.username,
        isBot: m.from?.is_bot === true,
      }
    : undefined;

  return {
    updateId: ctx && typeof ctx === "object" && (ctx as RawContext).update?.update_id !== undefined
      ? (ctx as RawContext).update!.update_id!
      : 0,
    updateKind: kind,
    chat: {
      id: String(m.chat.id),
      type: chatType,
      title: m.chat.title,
      username: m.chat.username,
      isForum: m.chat.is_forum === true,
    },
    message: {
      id: m.message_id !== undefined ? String(m.message_id) : "0",
      threadId,
      isEdited: kind === "edited_message" || kind === "edited_channel_post",
      editDate: m.edit_date,
      sender,
      contentKind,
      text: m.text,
      caption: m.caption,
      telegramFileId,
      telegramFileUniqueId,
      mimeType,
      fileName,
      fileSize,
      voiceDuration,
      photo: m.photo,
      document: m.document,
      voice: m.voice,
      contact: m.contact,
      location: m.location,
      isService: isServiceMessage(m),
      botMentioned,
      repliedToBot,
      startsWithOtherMention,
    },
  };
}
