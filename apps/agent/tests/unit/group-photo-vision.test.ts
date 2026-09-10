/**
 * Group Photo Vision OCR — контракт моста: OCR до агента (B2/B4), listener
 * фоном, pending-группа молчит, legacy-fallback не сломан.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelegramBridge,
  type TgMessage,
  type TgUpdate,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

const groupMsg = (extra: Partial<TgMessage> = {}): TgUpdate => ({
  updateId: 1,
  message: {
    from: { id: 42 },
    chat: { id: -100, type: "supergroup" },
    ...extra,
  },
});

describe("group photo vision (OCR before agent)", () => {
  it("photo allow path: агенту идёт Распознанный текст + expenseId, file_id справочно", async () => {
    const agentMessages: string[] = [];
    const processCalls: Array<{ kind: string; allowed: boolean; archive: boolean }> = [];
    const bridge = new TelegramBridge(
      [42],
      async (input) => {
        agentMessages.push(input.message);
        return { text: "ok" };
      },
      async () => undefined,
      {
        prefilter: () => true,
        processMedia: async (_msg, ctx) => {
          processCalls.push({ kind: ctx.kind, allowed: ctx.allowed, archive: ctx.archive });
          return {
            rawText: "ООО Ромашка\nИтого 1250 руб",
            confidence: 0.85,
            expenseId: "e-1",
            ingestedExpense: true,
          };
        },
      },
    );

    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, caption: "чек", photo: [{ file_id: "p1", file_unique_id: "pu1" }] }),
    );

    assert.equal(res.handled, true);
    assert.equal(processCalls.length, 1);
    assert.deepEqual(processCalls[0], { kind: "photo", allowed: true, archive: false });
    const m = agentMessages[0];
    assert.ok(m.includes("Распознанный текст (OCR):"), "OCR-блок присутствует");
    assert.ok(m.includes("Итого 1250 руб"), "OCR-текст в промпте агента");
    assert.ok(m.includes("Документ сохранён в expenses id=e-1"));
    assert.ok(m.includes("telegram_file_id: p1"));
  });

  it("document allow path: processMedia kind=document", async () => {
    const processCalls: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "ok" }),
      async () => undefined,
      {
        prefilter: () => true,
        processMedia: async (_msg, ctx) => {
          processCalls.push(ctx.kind);
          return { rawText: "Счёт №2\nСумма 300 руб" };
        },
      },
    );
    await bridge.handleUpdate(
      groupMsg({
        text: undefined,
        document: { file_id: "d1", file_name: "invoice.jpg", mime_type: "image/jpeg" },
      }),
    );
    assert.deepEqual(processCalls, ["document"]);
  });

  it("listen_only без mention: processMedia вызван, агент НЕ вызван, ответа нет", async () => {
    let agentCalls = 0;
    let processCalls = 0;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        prefilter: (input) => ({
          process: false,
          suppressReply: true,
          archive: input.isGroup === true,
        }),
        processMedia: async () => {
          processCalls++;
          return { rawText: "текст чека", confidence: 0.5 };
        },
      },
    );

    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1", file_unique_id: "pu1" }] }),
    );

    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.equal(processCalls, 1, "OCR+архив фоном");
    assert.equal(agentCalls, 0, "агент не вызывается без обращения");
    assert.equal(sent.length, 0, "тишина в чате");
  });

  it("pending-группа: processMedia не вызывается, агент не вызывается", async () => {
    let agentCalls = 0;
    let processCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prepareTurn: () => ({ process: false, suppressReply: false, archive: false, rulesContext: "" }),
        processMedia: async () => {
          processCalls++;
          return { rawText: "x" };
        },
      },
    );

    const res = await bridge.handleUpdate(
      groupMsg({
        text: undefined,
        groupConfigured: false,
        photo: [{ file_id: "p1" }],
      }),
    );

    assert.equal(res.handled, true);
    assert.equal(res.reason, "blocked-by-rules");
    assert.equal(processCalls, 0, "OCR-штурма в pending-группе нет");
    assert.equal(agentCalls, 0);
  });

  it("OCR fail → агенту честная ошибка с подписью, процесс не падает", async () => {
    const agentMessages: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async (input) => {
        agentMessages.push(input.message);
        return { text: "ok" };
      },
      async () => undefined,
      {
        prefilter: () => true,
        processMedia: async () => ({ failed: true }),
      },
    );

    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, caption: "чек", photo: [{ file_id: "p1" }] }),
    );
    assert.equal(res.handled, true);
    assert.ok(agentMessages[0].includes("Не удалось распознать изображение."));
    assert.ok(agentMessages[0].includes("Подпись: чек"));
  });

  it("PDF-документ: честное сообщение о невозможности OCR", async () => {
    const agentMessages: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async (input) => {
        agentMessages.push(input.message);
        return { text: "ok" };
      },
      async () => undefined,
      {
        prefilter: () => true,
        processMedia: async () => ({ rawText: undefined, confidence: 0.1 }),
      },
    );

    await bridge.handleUpdate(
      groupMsg({
        text: undefined,
        document: { file_id: "d1", file_name: "act.pdf", mime_type: "application/pdf" },
      }),
    );
    assert.ok(agentMessages[0].includes("PDF не поддерживается"), "PDF не притворяется JPEG");
  });

  it("notify от processMedia доходит до чата даже в тихом режиме (policy)", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        prefilter: (input) => ({
          process: false,
          suppressReply: true,
          archive: input.isGroup === true,
        }),
        processMedia: async () => ({
          rawText: "мусор",
          notify: "Не удалось уверенно распознать документ.",
        }),
      },
    );
    await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1" }] }),
    );
    assert.deepEqual(sent, ["Не удалось уверенно распознать документ."]);
  });

  it("legacy без processMedia: documentIngest ack как раньше", async () => {
    let agentCalls = 0;
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async (_chatId, text) => {
        sent.push(text);
      },
      {
        prefilter: () => true,
        documentIngest: async () => ({ ack: "Сохранил: Ромашка — 100 RUB" }),
      },
    );

    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1" }] }),
    );
    assert.equal(res.reason, "document-ingested");
    assert.equal(agentCalls, 0);
    assert.deepEqual(sent, ["Сохранил: Ромашка — 100 RUB"]);
  });

  it("legacy без processMedia: archiveHandler для фото как раньше (archivist)", async () => {
    const archives: string[] = [];
    let agentCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prefilter: (input) => ({
          process: true,
          suppressReply: input.botMentioned !== true,
          archive: input.isGroup === true,
        }),
        archiveHandler: async (_msg, ctx) => {
          archives.push(ctx.kind);
          return { stored: true };
        },
      },
    );
    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1" }] }),
    );
    assert.equal(res.reason, "archived-silent");
    assert.deepEqual(archives, ["photo"]);
    assert.equal(agentCalls, 1);
  });
});
