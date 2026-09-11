/**
 * Инструмент send_file — отправка локального файла в текущий Telegram-чат.
 *
 * Доступен только в Telegram-субсессиях (добавлен в SUB_SESSION_EXTENSIONS
 * пула). Целевой chatId/threadId берутся из контекста сессии
 * (user-rules/context.ts), который пул устанавливает перед каждым prompt —
 * никаких глобальных переменных. Фактическая отправка — через мост
 * file-send-bridge.ts в контроллер (текущий bot instance + per-chat очередь +
 * sendWithRetry, уважает retry_after/429).
 */
import { Type, type Static } from "typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSessionContext } from "../user-rules/context.js";
import { getUsersService } from "../../../src/services/UsersService.js";
import {
  getTelegramFileAclCheck,
  getTelegramFileSender,
} from "../telegram-bot/file-send-bridge.js";
import { validateSendFile, resolveOutboundFile, defaultFileRoots } from "../telegram-bot/file-send.js";
import { getDocumentsRepository } from "../../../src/services/documents/index.js";
import { LocalMediaStorage } from "../../../src/services/documents/media-storage.js";

const SendFileSchema = Type.Object({
  filePath: Type.Optional(Type.String({ minLength: 1 })),
  /** G2: отправить сохранённый медиа-файл из архива (вместо filePath). */
  storageKey: Type.Optional(Type.String({ minLength: 1 })),
  /** G2: photo (sendPhoto) или document (default). */
  kind: Type.Optional(Type.Union([Type.Literal("photo"), Type.Literal("document")])),
  caption: Type.Optional(Type.String({ maxLength: 1024 })),
  /** B3: явный целевой чат (по умолчанию — текущий; чужой — только canManage). */
  chatId: Type.Optional(Type.String({ minLength: 1 })),
});
type SendFileParams = Static<typeof SendFileSchema>;

/** B4: короткие пользовательские ошибки. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith("storageKey not found")) return "Файл в архиве не найден (storageKey).";
  if (msg.startsWith("path not in allowed roots")) return "Путь вне разрешённых каталогов.";
  if (msg.startsWith("file not found")) return "Файл не найден на диске.";
  if (msg === "Provide filePath or storageKey") return "Укажите filePath или storageKey.";
  return msg;
}

function fail(text: string): AgentToolResult<{ error?: string }> {
  return {
    content: [{ type: "text", text }],
    details: { error: text },
  };
}

export default function telegramFileSend(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "send_file",
    label: "Отправить файл в Telegram-чат",
    description:
      "Отправить файл или фото в Telegram-чат (тот же чат/тема, откуда пришёл запрос). " +
      "filePath — абсолютный или относительный путь к файлу на диске; storageKey — ключ " +
      "медиа-архива (chat_archive/media store), это НЕ путь. Never pass storageKey value " +
      "in filePath — если у вас только ключ архива, используйте storageKey.",
    parameters: SendFileSchema,
    async execute(
      _toolCallId: string,
      params: SendFileParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ fileId?: string; messageId?: number; error?: string }>> {
      // Целевой чат — из контекста сессии, установленного пулом перед prompt.
      const sessionCtx = getSessionContext(ctx.sessionManager.getSessionId());
      if (!sessionCtx?.chatId) {
        return fail("send_file доступен только в Telegram-чате (не в основной сессии).");
      }
      const { chatId, userId, threadId } = sessionCtx;

      // B3: явный целевой чат — только для canManage (кросс-чат требует прав).
      let targetChatId = chatId;
      if (params.chatId && params.chatId !== chatId) {
        const users = getUsersService();
        if (!(await users.canManage(userId))) {
          return fail("Отправка в другой чат требует прав owner/admin.");
        }
        targetChatId = params.chatId;
      }

      // ACL: тот же источник прав, что и у остальных действий в чате
      // (UsersService.isAllowed); мост позволяет переопределить в тестах.
      const acl = getTelegramFileAclCheck() ?? ((u: string, c: string) => getUsersService().isAllowed(u, c));
      if (!(await acl(userId, targetChatId))) {
        return fail("Нет доступа: отправка файлов этому пользователю запрещена.");
      }

      // B1: единый resolver — storageKey (архив) ИЛИ filePath (диск).
      let resolved: { absolutePath: string; source: "path" | "storage" };
      try {
        resolved = await resolveOutboundFile(
          { filePath: params.filePath, storageKey: params.storageKey },
          {
            resolveStorageKey: async (key) => {
              const rec = getDocumentsRepository().findMediaByStorageKey(targetChatId, key);
              if (!rec) return null;
              const storage = new LocalMediaStorage();
              if (!(await storage.exists(rec.storageKey))) return null;
              return storage.pathOf(rec.storageKey);
            },
            allowedRoots: defaultFileRoots(),
          },
        );
      } catch (err: unknown) {
        return fail(friendlyError(err));
      }

      const valid = validateSendFile(resolved.absolutePath, {
        allowedRoots: defaultFileRoots(),
      });
      if (!valid.ok) return fail(valid.error);

      const sender = getTelegramFileSender();
      if (!sender) {
        return fail("Telegram-бот не запущен — файл отправить некуда.");
      }

      // Лог side-effect: кто, что, куда (минимальное требование безопасности).
      console.log(
        `[telegram-file-send] userId=${userId} chatId=${targetChatId} ` +
          `source=${resolved.source} file=${valid.resolvedPath} size=${valid.sizeBytes}`,
      );

      const result = await sender({
        chatId: Number(targetChatId),
        filePath: valid.resolvedPath,
        caption: params.caption,
        threadId: targetChatId === chatId && threadId !== undefined ? Number(threadId) : undefined,
        kind: params.kind,
      });

      if (!result.ok) {
        const error = result.error ?? "Не удалось отправить файл.";
        console.error(`[telegram-file-send] failed: ${error}`);
        return fail(error);
      }

      console.log(
        `[telegram-file-send] sent file_id=${result.fileId ?? "?"} message_id=${result.messageId ?? "?"}`,
      );
      const ids = [
        result.fileId ? `file_id=${result.fileId}` : "",
        result.messageId !== undefined ? `message_id=${result.messageId}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        content: [{ type: "text", text: `Файл отправлен в чат.${ids ? ` ${ids}` : ""}` }],
        details: { fileId: result.fileId, messageId: result.messageId },
      };
    },
  });
}
