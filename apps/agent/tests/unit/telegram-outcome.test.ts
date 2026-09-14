/**
 * PROMPT 7: RECEIVE/ARCHIVE/INVOKE observability — outcome-трасса каждого
 * апдейта: одна JSON-строка `[telegram-bot] update outcome {...}` с полями
 * updateId/chatId/threadId/userId/kind/invoked/archived/reason/blockReason/
 * mediaStatus. Отвечает на вопрос «почему сообщение не вызвало агента?»
 * без чтения пользовательского текста.
 *
 * Инварианты:
 *  - бизнес-семантика не меняется (возвраты handleUpdate прежние);
 *  - пользовательский текст НЕ логируется.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelegramBridge,
  updateContentKind,
  type ProcessMediaResult,
} from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { prepareGroupTurn } from "../../.pi/extensions/telegram-bot/group-runtime.js";
import { evaluatePreFilter } from "../../.pi/extensions/user-rules/prefilter.js";
import type { UserRule } from "@griha/shared-types";

type OutcomeEntry = {
  updateId: number;
  kind: string;
  invoked: boolean;
  archived: boolean;
  reason: string;
  chatId?: number;
  threadId?: string;
  userId?: number;
  senderChatId?: number;
  blockReason?: string;
  mediaStatus?: string;
};

function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  return {
    lines,
    restore: () => {
      console.log = orig;
    },
  };
}

function outcomeEntries(lines: string[]): OutcomeEntry[] {
  const prefix = "[telegram-bot] update outcome ";
  return lines
    .filter((l) => l.startsWith(prefix))
    .map((l) => JSON.parse(l.slice(prefix.length)) as OutcomeEntry);
}

const MARKER = "СЕКРЕТНЫЙ_МАРКЕР_ТЕКСТ";

/** Bridge с реальным prepareTurn (prepareGroupTurn + evaluatePreFilter). */
function makeBridge(opts: {
  rules?: UserRule[];
  agentCalls?: string[];
  archiveHandler?: (msg: unknown) => Promise<{ stored: boolean }>;
  processMedia?: (msg: unknown, ctx: unknown) => Promise<ProcessMediaResult | null>;
  aclCheck?: (userId: string, chatId: string) => boolean | Promise<boolean>;
  isGroupConfigured?: (chatId: string) => boolean;
}): TelegramBridge {
  const rules = opts.rules ?? [];
  return new TelegramBridge(
    [1],
    async (input) => {
      opts.agentCalls?.push(input.message);
      return { text: "ок" };
    },
    async () => {},
    {
      prepareTurn: (input) =>
        prepareGroupTurn(input, {
          isGroupConfigured: opts.isGroupConfigured ?? (() => true),
          getHardRules: () => rules,
          getSoftRules: () => [],
          evaluate: (r, i) => evaluatePreFilter(r, i),
          formatRules: () => "",
        }),
      archiveHandler: opts.archiveHandler as never,
      processMedia: opts.processMedia as never,
      aclCheck: opts.aclCheck,
    },
  );
}

const groupMsg = (updateId: number, text: string, extra: Record<string, unknown> = {}) => ({
  updateId,
  message: {
    from: { id: 1 },
    chat: { id: -1005, type: "supergroup" },
    groupConfigured: true,
    text,
    ...extra,
  },
});

describe("telegram update outcome trace (PROMPT 7)", () => {
  it("1. normal private message: invoked=true, archived=false, без текста в логе", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = new TelegramBridge(
        [1],
        async (input) => {
          calls.push(input.message);
          return { text: "ок" };
        },
        async () => {},
      );
      await bridge.handleUpdate({
        updateId: 1,
        message: { from: { id: 1 }, chat: { id: 9, type: "private" }, text: `привет ${MARKER}` },
      });
      const [out] = outcomeEntries(lines);
      assert.ok(out, "outcome есть");
      assert.equal(out.invoked, true);
      assert.equal(out.archived, false);
      assert.equal(out.reason, "handled");
      assert.equal(out.kind, "text");
      assert.equal(out.userId, 1);
      assert.equal(out.chatId, 9);
      assert.ok(lines.every((l) => !l.includes(MARKER)), "текст пользователя не логируется");
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  it("2. configured group mention: invoked=true", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = makeBridge({ agentCalls: calls });
      await bridge.handleUpdate(groupMsg(2, `Гриша, ${MARKER}`, { botMentioned: true }));
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, true);
      assert.equal(out.reason, "handled");
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  it("3. group ordinary message: invoked=true, archived=false", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const bridge = makeBridge({});
      await bridge.handleUpdate(groupMsg(3, `обычное ${MARKER}`));
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, true);
      assert.equal(out.archived, false);
    } finally {
      restore();
    }
  });

  it("4. require_mention block: invoked=false, blockReason=require_mention, return прежний", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = makeBridge({
        agentCalls: calls,
        rules: [{ key: "require_mention", value: true } as UserRule],
      });
      const res = await bridge.handleUpdate(groupMsg(4, `${MARKER} без упоминания`));
      // Совместимость: возвращаемый reason не меняется.
      assert.equal(res.reason, "blocked-by-rules");
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, false);
      assert.equal(out.reason, "blocked-by-rules");
      assert.equal(out.blockReason, "require_mention");
      assert.equal(out.archived, false);
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  it("5. listen_only: archived=true, blockReason=listen_only, invoked=false", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = makeBridge({
        agentCalls: calls,
        rules: [{ key: "listen_only", value: true } as UserRule],
        archiveHandler: async () => ({ stored: true }),
      });
      const res = await bridge.handleUpdate(groupMsg(5, `${MARKER} мимо`));
      assert.equal(res.reason, "archived-silent");
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, false);
      assert.equal(out.reason, "archived-silent");
      assert.equal(out.blockReason, "listen_only");
      assert.equal(out.archived, true);
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  it("6. channel_post: reason=channel-no-user, invoked=false", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const bridge = makeBridge({});
      await bridge.handleUpdate({
        updateId: 6,
        message: {
          senderChat: { id: 777, title: "канал" },
          chat: { id: -100777, type: "channel" },
          groupConfigured: true,
          text: `пост ${MARKER}`,
        },
      });
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, false);
      assert.equal(out.reason, "channel-no-user");
      assert.equal(out.senderChatId, 777);
    } finally {
      restore();
    }
  });

  it("7. media (фото): invoked=true, archived=true, mediaStatus=processed", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = makeBridge({
        agentCalls: calls,
        processMedia: async () => ({ rawText: "ocr", archived: true }),
      });
      await bridge.handleUpdate({
        updateId: 7,
        message: {
          from: { id: 1 },
          chat: { id: 9, type: "private" },
          photo: [{ file_id: "F7", file_unique_id: "U7" }],
          caption: `${MARKER} фото`,
        },
      });
      const [out] = outcomeEntries(lines);
      assert.equal(out.kind, "photo");
      assert.equal(out.invoked, true);
      assert.equal(out.archived, true);
      assert.equal(out.mediaStatus, "processed");
      assert.ok(lines.every((l) => !l.includes(MARKER)));
    } finally {
      restore();
    }
  });

  it("8. ACL denied: reason=acl-denied, invoked=false", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const calls: string[] = [];
      const bridge = makeBridge({ agentCalls: calls, aclCheck: async () => false });
      await bridge.handleUpdate({
        updateId: 8,
        message: { from: { id: 1 }, chat: { id: 9, type: "private" }, text: `текст ${MARKER}` },
      });
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, false);
      assert.equal(out.reason, "acl-denied");
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  it("9. service message: invoked=false, blockReason=service-ignored", async () => {
    const { lines, restore } = captureConsoleLog();
    try {
      const bridge = makeBridge({
        rules: [{ key: "ignore_service", value: true } as UserRule],
      });
      await bridge.handleUpdate(groupMsg(9, "служебное", { isService: true }));
      const [out] = outcomeEntries(lines);
      assert.equal(out.invoked, false);
      assert.equal(out.reason, "blocked-by-rules");
      assert.equal(out.blockReason, "service-ignored");
    } finally {
      restore();
    }
  });

  it("10. updateContentKind: классификация без текста", () => {
    assert.equal(updateContentKind({ text: "x" }), "text");
    assert.equal(updateContentKind({ photo: [{ file_id: "f" }] }), "photo");
    assert.equal(updateContentKind({ voice: { file_id: "f" } }), "voice");
    assert.equal(updateContentKind({ contact: { first_name: "x" } }), "contact");
  });
});
