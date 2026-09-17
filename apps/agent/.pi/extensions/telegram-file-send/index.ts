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
import {
  beginFileSend,
  endFileSend,
  hasPendingContentSha256,
  hasPendingDedupeKey,
  hasPendingSessionFile,
  sha256OfFileSync,
  wasRecentlySentContentSha256,
  wasRecentlySentDedupeKey,
  wasRecentlySentFile,
} from "../../../src/utils/telegram/session-files.js";
import { logTelegramEvent } from "../telegram-bot/telegram-diagnostics.js";
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
  /** E4: ключ дедупа (тот же, что у session-file инструмента-источника). */
  dedupeKey: Type.Optional(Type.String({ minLength: 1 })),
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
    ): Promise<AgentToolResult<{ fileId?: string; messageId?: number; error?: string; suppressed?: boolean }>> {
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

      // E4: тот же файл/ключ уже стоит в очереди session-file (автодоставка)
      // или был недавно отправлен → повторная отправка подавляется.
      // P3: content SHA256 — дополнительный сигнал: копия сгенерированного
      // отчёта в другом пути (bash cp → /tmp) тоже подавляется.
      const sessionId = ctx.sessionManager.getSessionId();
      const correlationId = sessionCtx?.correlationId;
      const contentSha256 = sha256OfFileSync(valid.resolvedPath);
      if (contentSha256 === undefined) {
        console.log(
          `[telegram-file-send] content hash unavailable file=${valid.resolvedPath} ` +
            `size=${valid.sizeBytes} — content-dedupe skipped`,
        );
      }
      const duplicate =
        hasPendingSessionFile(sessionId, valid.resolvedPath) ||
        wasRecentlySentFile(sessionId, valid.resolvedPath) ||
        // P3: content-дедуп только для «анонимной» копии (без dedupeKey) —
        // если LLM явно назвал ключ, это другой логический artifact, и
        // одинаковый SHA256 не должен подавлять его отправку.
        (params.dedupeKey === undefined &&
          (hasPendingContentSha256(sessionId, contentSha256) ||
            wasRecentlySentContentSha256(sessionId, contentSha256))) ||
        (params.dedupeKey !== undefined &&
          (hasPendingDedupeKey(sessionId, params.dedupeKey) ||
            wasRecentlySentDedupeKey(sessionId, params.dedupeKey)));
      if (duplicate) {
        logTelegramEvent({
          event: "file.send.deduplicated",
          correlationId,
          chatId: targetChatId,
          sessionId,
          status: "deduplicated",
          fileSize: valid.sizeBytes,
          sha256: contentSha256,
          artifactId: params.dedupeKey,
        });
        console.log(
          `[telegram-file-send] duplicate send suppressed session=${sessionId} ` +
            `file=${valid.resolvedPath} dedupeKey=${params.dedupeKey ?? "-"}`,
        );
        return {
          content: [
            {
              type: "text",
              text: "Файл уже был отправлен в этом чате (повторная отправка подавлена).",
            },
          ],
          details: { suppressed: true },
        };
      }

      const sender = getTelegramFileSender();
      if (!sender) {
        return fail("Telegram-бот не запущен — файл отправить некуда.");
      }

      // P3: concurrent duplicate send — тот же артефакт уже отправляется
      // (синхронная атомарная пометка, без окна между check и set).
      if (!beginFileSend(sessionId, valid.resolvedPath, contentSha256)) {
        logTelegramEvent({
          event: "file.send.deduplicated",
          correlationId,
          chatId: targetChatId,
          sessionId,
          status: "concurrent",
          fileSize: valid.sizeBytes,
          sha256: contentSha256,
          artifactId: params.dedupeKey,
        });
        console.log(
          `[telegram-file-send] concurrent duplicate suppressed session=${sessionId} ` +
            `file=${valid.resolvedPath}`,
        );
        return {
          content: [
            {
              type: "text",
              text: "Файл уже отправляется в этом чате (повторная отправка подавлена).",
            },
          ],
          details: { suppressed: true },
        };
      }

      // Лог side-effect: кто, что, куда (минимальное требование безопасности).
      console.log(
        `[telegram-file-send] userId=${userId} chatId=${targetChatId} ` +
          `source=${resolved.source} file=${valid.resolvedPath} size=${valid.sizeBytes}`,
      );

      const sendStartedAt = Date.now();
      logTelegramEvent({
        event: "file.send.started",
        correlationId,
        chatId: targetChatId,
        sessionId,
        fileSize: valid.sizeBytes,
        sha256: contentSha256,
        artifactId: params.dedupeKey,
      });

      let result: Awaited<ReturnType<typeof sender>> = { ok: false };
      try {
        result = await sender({
          chatId: Number(targetChatId),
          filePath: valid.resolvedPath,
          caption: params.caption,
          threadId: targetChatId === chatId && threadId !== undefined ? Number(threadId) : undefined,
          kind: params.kind,
        });
      } finally {
        endFileSend(sessionId, valid.resolvedPath, contentSha256);
      }

      if (!result.ok) {
        const error = result.error ?? "Не удалось отправить файл.";
        logTelegramEvent({
          event: "file.send.failed",
          correlationId,
          chatId: targetChatId,
          sessionId,
          durationMs: Date.now() - sendStartedAt,
          status: "failed",
          fileSize: valid.sizeBytes,
          sha256: contentSha256,
          artifactId: params.dedupeKey,
        });
        console.error(`[telegram-file-send] failed: ${error}`);
        return fail(error);
      }

      logTelegramEvent({
        event: "file.send.completed",
        correlationId,
        chatId: targetChatId,
        sessionId,
        durationMs: Date.now() - sendStartedAt,
        status: "ok",
        fileSize: valid.sizeBytes,
        sha256: contentSha256,
        artifactId: params.dedupeKey,
      });
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
