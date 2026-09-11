/**
 * PROMPT 03 — Listener vs agent ACL: архив по chat policy без agent ACL,
 * агент — только после ACL. Spy на agent доказывает отсутствие LLM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { TgMessage, TgUpdate } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

const groupMsg = (extra: Partial<TgMessage> = {}): TgUpdate => ({
  updateId: 1,
  message: {
    from: { id: 999 }, // unauthorized участник
    chat: { id: -100, type: "supergroup" },
    text: "обычное сообщение",
    ...extra,
  },
});

/** Listener-policy: process только по mention, archive=true. */
const listenerPrefilter = (input: {
  botMentioned?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
}) => ({
  process: input.botMentioned === true,
  suppressReply: !input.botMentioned,
  archive: input.isGroup === true || input.isChannel === true,
});

describe("listener: archive отдельно от agent ACL", () => {
  it("unauthorized участник + listener text → архивирован, агент НЕ вызывался", async () => {
    let agentCalls = 0;
    const archives: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prefilter: listenerPrefilter,
        aclCheck: async () => false, // user НЕ в ACL
        archiveHandler: async (msg) => {
          archives.push(msg.text ?? "");
          return { stored: true };
        },
      },
    );
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
    assert.deepEqual(archives, ["обычное сообщение"], "архив по policy, несмотря на ACL");
    assert.equal(agentCalls, 0, "LLM не вызывался");
  });

  it("unauthorized участник + listener photo → OCR (processMedia), агент нет", async () => {
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
        prefilter: listenerPrefilter,
        aclCheck: async () => false,
        processMedia: async () => {
          processCalls++;
          return { rawText: "чек" };
        },
      },
    );
    const res = await bridge.handleUpdate(
      groupMsg({ text: undefined, photo: [{ file_id: "p1", file_unique_id: "pu1" }] }),
    );
    assert.equal(res.reason, "archived-silent");
    assert.equal(processCalls, 1, "OCR по policy без agent ACL");
    assert.equal(agentCalls, 0);
  });

  it("unauthorized участник + @mention → agent denied (ACL), без вызова LLM", async () => {
    let agentCalls = 0;
    const archives: string[] = [];
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
        prefilter: listenerPrefilter,
        aclCheck: async () => false,
        archiveHandler: async (msg) => {
          archives.push(msg.text ?? "");
          return { stored: true };
        },
      },
    );
    const res = await bridge.handleUpdate(groupMsg({ botMentioned: true, text: "@bot помоги" }));
    assert.equal(res.handled, true);
    assert.equal(res.reason, "acl-denied");
    assert.deepEqual(archives, ["@bot помоги"], "архив выполнен до ACL");
    assert.equal(agentCalls, 0, "mention не обходит ACL");
    assert.equal(sent.length, 0, "в группе — молча");
  });

  it("authorized участник + @mention → агент вызван", async () => {
    let agentCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "ответ" };
      },
      async () => undefined,
      {
        prefilter: listenerPrefilter,
        aclCheck: async (userId) => userId === "42",
      },
    );
    const res = await bridge.handleUpdate(
      groupMsg({ from: { id: 42 }, botMentioned: true, text: "@bot помоги" }),
    );
    assert.equal(res.handled, true);
    assert.equal(agentCalls, 1);
  });

  it("listener без mention → LLM не вызывается вообще (no agent, no rules LLM)", async () => {
    let agentCalls = 0;
    let archiveCalls = 0;
    const bridge = new TelegramBridge(
      [42],
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prefilter: listenerPrefilter,
        archiveHandler: async () => {
          archiveCalls++;
          return { stored: true };
        },
      },
    );
    await bridge.handleUpdate(groupMsg());
    assert.equal(agentCalls, 0);
    assert.equal(archiveCalls, 1);
  });

  it("ACL-сервис упал (throw) → архив listener'а всё равно работает (без mention)", async () => {
    const archives: string[] = [];
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        prefilter: listenerPrefilter,
        aclCheck: async () => {
          throw new Error("ACL down");
        },
        archiveHandler: async (msg) => {
          archives.push(msg.text ?? "");
          return { stored: true };
        },
      },
    );
    // Без mention: ACL не вызывается — архив не зависит от ACL-сервиса.
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.reason, "archived-silent");
    assert.equal(archives.length, 1);
  });

  it("archive failure → policy-решение неизменно (процесс не падает)", async () => {
    const bridge = new TelegramBridge(
      [42],
      async () => ({ text: "x" }),
      async () => undefined,
      {
        prefilter: listenerPrefilter,
        archiveHandler: async () => {
          throw new Error("archive db down");
        },
      },
    );
    const res = await bridge.handleUpdate(groupMsg());
    assert.equal(res.handled, true);
    assert.equal(res.reason, "archived-silent");
  });
});
