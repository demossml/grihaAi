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
import os from "node:os";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import { getSessionContext } from "../user-rules/context.js";
import { getUsersService } from "../../../src/services/UsersService.js";
import {
  getTelegramFileAclCheck,
  getTelegramFileSender,
} from "../telegram-bot/file-send-bridge.js";
import { validateSendFile } from "../telegram-bot/file-send.js";

const SendFileSchema = Type.Object({
  filePath: Type.String({ minLength: 1 }),
  caption: Type.Optional(Type.String({ maxLength: 1024 })),
});
type SendFileParams = Static<typeof SendFileSchema>;

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
      "Отправить локальный файл пользователю в текущий Telegram-чат (тот же чат/тема, " +
      "откуда пришёл запрос). Путь должен существовать и быть обычным файлом ≤50 МБ " +
      "внутри разрешённых каталогов (tmp/рабочая директория). Работает только в Telegram-сессии.",
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

      // ACL: тот же источник прав, что и у остальных действий в чате
      // (UsersService.isAllowed); мост позволяет переопределить в тестах.
      const acl = getTelegramFileAclCheck() ?? ((u: string, c: string) => getUsersService().isAllowed(u, c));
      if (!(await acl(userId, chatId))) {
        return fail("Нет доступа: отправка файлов этому пользователю запрещена.");
      }

      const valid = validateSendFile(params.filePath, {
        allowedRoots: [os.tmpdir(), process.cwd(), getConfigDir()],
      });
      if (!valid.ok) return fail(valid.error);

      const sender = getTelegramFileSender();
      if (!sender) {
        return fail("Telegram-бот не запущен — файл отправить некуда.");
      }

      // Лог side-effect: кто, что, куда (минимальное требование безопасности).
      console.log(
        `[telegram-file-send] userId=${userId} chatId=${chatId} ` +
          `file=${valid.resolvedPath} size=${valid.sizeBytes}`,
      );

      const result = await sender({
        chatId: Number(chatId),
        filePath: valid.resolvedPath,
        caption: params.caption,
        threadId: threadId !== undefined ? Number(threadId) : undefined,
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
