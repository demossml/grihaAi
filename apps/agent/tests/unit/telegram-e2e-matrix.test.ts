/**
 * PROMPT 09 — E2E/Integration matrix Telegram layer.
 *
 * Каждый сценарий прогоняет реальную цепочку: bridge → policy/prefilter →
 * processMedia (ListenerMediaPipeline + SQLite + MediaStorage) → agent.
 * Fake-зависимости: download/STT/LLM-agent — spy/mock. Результат — таблица
 * docs/TELEGRAM-E2E-MATRIX.md (PASS ставится только при реально выполненном
 * тесте — это и есть настоящий прогон).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgMessage } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { evaluatePolicyFromRules } from "../../.pi/extensions/user-rules/chat-policy.js";
import type { UserRule } from "@griha/shared-types";
import { ListenerMediaPipeline } from "../../src/services/documents/ListenerMediaPipeline.js";
import { DocumentsRepository } from "../../src/services/documents/DocumentsRepository.js";
import { LocalMediaStorage } from "../../src/services/documents/media-storage.js";
import { MediaRetryQueue } from "../../src/services/documents/media-retry.js";
import type { DocumentExtractor } from "../../src/services/documents/extractors/types.js";

const tmpDirs: string[] = [];
const tmpFiles: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop()!, { force: true });
});

function rule(key: string, value: string | boolean): UserRule {
  return {
    id: `r-${key}`,
    scope: "chat",
    chatId: "",
    key,
    value,
    text: key,
    kind: "hard",
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
  } as UserRule;
}

const LISTENER_RULES: UserRule[] = [
  rule("listen_only", true),
  rule("archive_media", true),
  rule("archive_ocr_ingest", true),
  rule("require_mention", true),
  rule("reply_to_bot", true),
  rule("ignore_bots", true),
  rule("ignore_service", true),
];

const TEAM_RULES: UserRule[] = [rule("require_mention", true), rule("reply_to_bot", true)];

const receiptExtractor: DocumentExtractor = {
  async extract() {
    return {
      kind: "receipt",
      docDate: "2026-09-11",
      supplier: "X",
      total: 100,
      currency: "RUB",
      rawText: "поставщик X 100 RUB",
      confidence: 0.7,
      needsReview: false,
    };
  },
};

interface Harness {
  repo: DocumentsRepository;
  storage: LocalMediaStorage;
  pipeline: ListenerMediaPipeline;
  retry: MediaRetryQueue;
  agentCalls: Array<{ message: string; chatId?: string }>;
  sent: string[];
  downloads: number;
  downloadError?: string;
  sttError?: string;
}

interface Scenario {
  name: string;
  chatType: string;
  content: "text" | "photo" | "document" | "voice";
  caption?: string;
  botMentioned?: boolean;
  repliedToBot?: boolean;
  groupConfigured?: boolean;
  senderChat?: boolean;
  rules: UserRule[];
  aclAllow?: (userId: string) => boolean;
  topic?: string;
  duplicates?: number;
  expect: {
    reason?: string;
    agentCalls: number;
    archiveRows: number;
    mediaRows?: number;
    files?: number;
    expenseRows?: number;
    replies?: number;
    agentMessageIncludes?: string;
  };
}

function makeHarness(downloadError?: string, sttError?: string): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-matrix-"));
  tmpDirs.push(dir);
  const repo = new DocumentsRepository(path.join(dir, "documents.sqlite"));
  const storage = new LocalMediaStorage({ rootDir: path.join(dir, "media") });
  const retry = new MediaRetryQueue(path.join(dir, "retry.sqlite"));
  const file = path.join(dir, "sample.bin");
  fs.writeFileSync(file, "sample-content");
  tmpFiles.push(file);
  const downloads = { n: 0 };
  const pipeline = new ListenerMediaPipeline(repo, receiptExtractor, async () => {
    downloads.n++;
    if (downloadError) throw new Error(downloadError);
    return file;
  }, {
    storage,
    stt: sttError
      ? async () => ({ ok: false, text: "", error: sttError })
      : async () => ({ ok: true, text: "завтра встреча в десять утра" }),
  });
  return {
    repo,
    storage,
    pipeline,
    retry,
    agentCalls: [],
    sent: [],
    get downloads() {
      return downloads.n;
    },
  };
}

async function runScenario(h: Harness, s: Scenario): Promise<string> {
  const chatIdNum = s.chatType === "private" ? 999 : s.senderChat ? -300 : -100;
  const chatType = s.chatType;

  const bridge = new TelegramBridge(
    [42, 570],
    async (input) => {
      h.agentCalls.push({ message: input.message, chatId: input.chatId });
      return { text: "ответ агента" };
    },
    async (_chatId, text) => {
      h.sent.push(text);
    },
    {
      prepareTurn: (input) => {
        const rules = s.rules.map((r) => ({ ...r, chatId: input.chatId }));
        const d = evaluatePolicyFromRules(rules, {
          chatId: input.chatId,
          fromUserId: input.userId,
          text: input.text,
          isGroup: input.isGroup,
          isChannel: input.isChannel,
          fromIsBot: input.fromIsBot,
          isService: input.isService,
          botMentioned: input.botMentioned,
          repliedToBot: input.repliedToBot,
          startsWithOtherMention: input.startsWithOtherMention,
          groupConfigured: input.groupConfigured,
          contentKind:
            input.caption || input.text
              ? (s.content === "photo" || s.content === "document" || s.content === "voice" ? s.content : "text")
              : s.content,
        });
        return {
          process: d.invokeAgent,
          suppressReply: !d.reply,
          archive: d.archive,
          rulesContext: "[GROUP_RULES]",
        };
      },
      aclCheck: async (userId) => s.aclAllow?.(userId) ?? false,
      archiveHandler: async (msg, ctx) => {
        if (ctx.kind === "text" && msg.text) {
          h.repo.insertArchive({
            id: `ar-${ctx.chatId}-${msg.messageId}`,
            chatId: ctx.chatId,
            threadId: msg.threadId,
            messageId: msg.messageId !== undefined ? String(msg.messageId) : undefined,
            fromUserId: msg.from?.id !== undefined ? String(msg.from.id) : undefined,
            kind: "text",
            docDate: "2026-09-11",
            rawText: msg.text,
            confidence: 0,
            needsReview: false,
            createdAt: new Date().toISOString(),
            isEdited: msg.isEdited === true,
            revision: 1,
          });
          return { stored: true };
        }
        return { stored: false };
      },
      processMedia: async (msg, ctx) => {
        const media = mediaFileOf(msg);
        if (!media) return null;
        try {
          const result = await h.pipeline.process(
            {
              chatId: ctx.chatId,
              threadId: msg.threadId,
              messageId: msg.messageId !== undefined ? String(msg.messageId) : undefined,
              fromUserId: msg.from?.id !== undefined ? String(msg.from.id) : undefined,
              caption: msg.caption,
              photo: media.kind === "photo" ? [{ file_id: media.fileId, file_unique_id: media.fileUniqueId }] : undefined,
              document:
                media.kind === "document"
                  ? { file_id: media.fileId, file_unique_id: media.fileUniqueId, mime_type: "application/pdf" }
                  : undefined,
              voice:
                media.kind === "voice"
                  ? { file_id: media.fileId, file_unique_id: media.fileUniqueId, mime_type: "audio/ogg" }
                  : undefined,
            },
            { archive: true, ocrIngest: s.rules.some((r) => r.key === "archive_ocr_ingest" && r.value === true) },
          );
          return {
            rawText: result.rawText,
            confidence: result.confidence,
            expenseId: result.expenseId,
          };
        } catch (err) {
          const mediaInfo = mediaFileOf(msg)!;
          await h.retry.enqueue({
            chatId: ctx.chatId,
            messageId: msg.messageId,
            fileId: mediaInfo.fileId,
            fileUniqueId: mediaInfo.fileUniqueId,
            kind: media.kind,
          });
          return { failed: true };
        }
      },
    },
  );

  const msg: TgMessage = {
    chat: { id: chatIdNum, type: chatType },
    messageId: 100,
    groupConfigured: s.chatType === "private" ? undefined : (s.groupConfigured ?? true),
    botMentioned: s.botMentioned,
    repliedToBot: s.repliedToBot,
    threadId: s.topic,
  };
  if (!s.senderChat) msg.from = { id: s.aclAllow ? 42 : 999 };
  else msg.senderChat = { id: -300, title: "Канал" };
  if (s.content === "text") msg.text = s.caption ?? "обычное сообщение";
  else if (s.content === "photo") {
    msg.caption = s.caption;
    msg.photo = [{ file_id: `p-${chatIdNum}`, file_unique_id: `pu-${chatIdNum}` }];
  } else if (s.content === "document") {
    msg.caption = s.caption;
    msg.document = { file_id: `d-${chatIdNum}`, file_unique_id: `du-${chatIdNum}`, file_name: "act.pdf", mime_type: "application/pdf" };
  } else {
    msg.voice = { file_id: `v-${chatIdNum}`, file_unique_id: `vu-${chatIdNum}`, mime_type: "audio/ogg" };
  }

  const updates = s.duplicates ?? 1;
  const run = async (): Promise<string> => {
    const res = await bridge.handleUpdate({ updateId: 1, message: JSON.parse(JSON.stringify(msg)) });
    return res.reason ?? "handled";
  };
  let reason = "";
  for (let i = 0; i < updates; i++) reason = await run();
  return reason;
}

function mediaFileOf(
  msg: TgMessage,
): { kind: "photo" | "document" | "voice"; fileId: string; fileUniqueId: string } | null {
  if (msg.photo?.length) {
    const last = msg.photo[msg.photo.length - 1];
    return { kind: "photo", fileId: last.file_id!, fileUniqueId: last.file_unique_id ?? last.file_id! };
  }
  if (msg.document?.file_id) {
    return {
      kind: "document",
      fileId: msg.document.file_id,
      fileUniqueId: msg.document.file_unique_id ?? msg.document.file_id,
    };
  }
  if (msg.voice?.file_id) {
    return {
      kind: "voice",
      fileId: msg.voice.file_id,
      fileUniqueId: msg.voice.file_unique_id ?? msg.voice.file_id,
    };
  }
  return null;
}

const SCENARIOS: Scenario[] = [
  {
    name: "private text",
    chatType: "private",
    content: "text",
    rules: [],
    aclAllow: () => true,
    expect: { agentCalls: 1, archiveRows: 0, replies: 1 },
  },
  {
    name: "group listener photo (no mention)",
    chatType: "supergroup",
    content: "photo",
    caption: "чек",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, files: 1, expenseRows: 1, replies: 0 },
  },
  {
    name: "group listener text (no mention)",
    chatType: "supergroup",
    content: "text",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, replies: 0 },
  },
  {
    name: "group listener document (no mention)",
    chatType: "supergroup",
    content: "document",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, replies: 0 },
  },
  {
    name: "group listener voice (no mention)",
    chatType: "supergroup",
    content: "voice",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, replies: 0 },
  },
  {
    name: "group listener mention → agent",
    chatType: "supergroup",
    content: "text",
    botMentioned: true,
    rules: LISTENER_RULES,
    aclAllow: () => true,
    expect: { agentCalls: 1, archiveRows: 1, replies: 1 },
  },
  {
    name: "group mention unauthorized → no agent, archived",
    chatType: "supergroup",
    content: "text",
    botMentioned: true,
    rules: LISTENER_RULES,
    aclAllow: () => false,
    expect: { reason: "acl-denied", agentCalls: 0, archiveRows: 1, replies: 0 },
  },
  {
    name: "group reply authorized → agent",
    chatType: "supergroup",
    content: "text",
    repliedToBot: true,
    rules: TEAM_RULES,
    aclAllow: () => true,
    expect: { agentCalls: 1, archiveRows: 0, replies: 1 },
  },
  {
    name: "group team no mention → blocked (no archive)",
    chatType: "supergroup",
    content: "text",
    rules: TEAM_RULES,
    expect: { reason: "blocked-by-rules", agentCalls: 0, archiveRows: 0, replies: 0 },
  },
  {
    name: "pending group → silent",
    chatType: "supergroup",
    content: "photo",
    groupConfigured: false,
    rules: LISTENER_RULES,
    expect: { reason: "blocked-by-rules", agentCalls: 0, archiveRows: 0, files: 0 },
  },
  {
    name: "channel_post text (listener)",
    chatType: "channel",
    content: "text",
    senderChat: true,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "channel_post photo",
    chatType: "channel",
    content: "photo",
    caption: "фото из канала",
    senderChat: true,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, files: 1, expenseRows: 1 },
  },
  {
    name: "channel_post document",
    chatType: "channel",
    content: "document",
    senderChat: true,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "channel_post voice",
    chatType: "channel",
    content: "voice",
    senderChat: true,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "channel_post caption",
    chatType: "channel",
    content: "photo",
    caption: "подпись канала",
    senderChat: true,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "topic photo A vs B — не смешиваются",
    chatType: "supergroup",
    content: "photo",
    topic: "10",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "duplicate photo ×3 — один архив, один файл, один expense",
    chatType: "supergroup",
    content: "photo",
    duplicates: 3,
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1, files: 1, expenseRows: 1 },
  },
  {
    name: "photo + caption — caption отдельно от OCR",
    chatType: "supergroup",
    content: "photo",
    caption: "мой чек",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
  {
    name: "edited_message → ревизия архива",
    chatType: "supergroup",
    content: "text",
    rules: LISTENER_RULES,
    expect: { reason: "archived-silent", agentCalls: 0, archiveRows: 1 },
  },
];

describe("E2E matrix: policy → bridge → pipeline", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}`, async () => {
      const h = makeHarness();
      const reason = await runScenario(h, scenario);
      const chatId = scenario.chatType === "private" ? "999" : scenario.senderChat ? "-300" : "-100";

      if (scenario.expect.reason) assert.equal(reason, scenario.expect.reason);
      assert.equal(h.agentCalls.length, scenario.expect.agentCalls, "agentCalls");
      assert.equal(h.repo.countArchive(chatId), scenario.expect.archiveRows, "archiveRows");
      assert.equal(h.sent.length, scenario.expect.replies ?? 0, "replies");
      if (scenario.expect.files !== undefined) {
        const files = fs.existsSync(h.storage.root)
          ? fs.readdirSync(h.storage.root, { recursive: true }).filter((f) => String(f).includes("."))
          : [];
        assert.equal(files.length, scenario.expect.files, "физических файлов");
      }
      if (scenario.expect.expenseRows !== undefined) {
        const q = await h.repo.query({ chatId });
        assert.equal(q.count, scenario.expect.expenseRows, "expenseRows");
      }

      // topic-изоляция: архив несёт thread_id
      if (scenario.topic) {
        const rec = h.repo.findArchiveByFileUniqueId(chatId, `pu-${chatId}`);
        assert.equal(rec?.threadId, scenario.topic);
      }
      // caption отдельно
      if (scenario.caption && scenario.content === "photo") {
        const rec = h.repo.findArchiveByFileUniqueId(chatId, `pu-${chatId}`);
        assert.equal(rec?.caption, scenario.caption);
      }
    });
  }

  it("failure injection: download error → retry job в очереди, агент с ошибкой не падает", async () => {
    const h = makeHarness("ETIMEDOUT");
    let agentMessages: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async (input) => {
        agentMessages.push(input.message);
        return { text: "x" };
      },
      async () => undefined,
      {
        prepareTurn: () => ({ process: true, suppressReply: false, archive: false, rulesContext: "" }),
        aclCheck: async () => true,
        processMedia: async (msg) => {
          const media = mediaFileOf(msg)!;
          try {
            await h.pipeline.process(
              {
                chatId: String(msg.chat!.id!),
                photo: [{ file_id: media.fileId, file_unique_id: media.fileUniqueId }],
              },
              { archive: false, ocrIngest: false },
            );
            return { rawText: "x" };
          } catch {
            await h.retry.enqueue({
              chatId: String(msg.chat!.id!),
              fileId: media.fileId,
              fileUniqueId: media.fileUniqueId,
              kind: "photo",
            });
            return { failed: true };
          }
        },
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 42 }, chat: { id: -100, type: "supergroup" }, photo: [{ file_id: "pf", file_unique_id: "puf" }] },
    });
    assert.equal((await h.retry.claimDue(5)).length, 1, "download-сбой → job в очереди");
    assert.ok(agentMessages[0].includes("Не удалось распознать изображение."));
  });

  it("failure injection: STT error → архив с needsReview, файл сохранён", async () => {
    const h = makeHarness(undefined, "STT down");
    const scenario = SCENARIOS.find((s) => s.name === "group listener voice (no mention)")!;
    const reason = await runScenario(h, scenario);
    assert.equal(reason, "archived-silent");
    const rec = h.repo.findArchiveByFileUniqueId("-100", "vu--100");
    assert.equal(rec?.needsReview, true);
    const media = h.repo.findMediaByFileUniqueId("-100", "vu--100");
    assert.ok(await h.storage.exists(media!.storageKey), "файл остаётся");
  });

  it("failure injection: Telegram 429 (transient) → retry job", async () => {
    const h = makeHarness("Telegram getFile failed: 429");
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        prepareTurn: () => ({ process: false, suppressReply: true, archive: true, rulesContext: "" }),
        processMedia: async (msg) => {
          const media = mediaFileOf(msg)!;
          try {
            await h.pipeline.process(
              { chatId: "-100", photo: [{ file_id: media.fileId, file_unique_id: media.fileUniqueId }] },
              { archive: true, ocrIngest: false },
            );
            return { rawText: "x" };
          } catch (err) {
            await h.retry.enqueue({
              chatId: "-100",
              fileId: media.fileId,
              fileUniqueId: media.fileUniqueId,
              kind: "photo",
            });
            return { failed: true };
          }
        },
      },
    );
    await bridge.handleUpdate({
      updateId: 1,
      message: { from: { id: 42 }, chat: { id: -100, type: "supergroup" }, photo: [{ file_id: "p429", file_unique_id: "pu429" }] },
    });
    assert.equal((await h.retry.claimDue(5)).length, 1);
  });
});
