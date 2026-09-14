/**
 * PROMPT 9: explicit contract — POLICY = PER CHAT, SESSION = PER USER+CHAT+THREAD.
 *
 * Семантика зафиксирована (см. docs/TELEGRAM-BOT.md «Scope-семантика»):
 *   - разные темы форума → отдельные сессии (история/контекст);
 *   - policy/rules/onboarding/ACL — общие на чат;
 *   - ответы роутятся в тему входящего сообщения.
 *
 * Эти тесты НЕ меняют runtime — они pin-ят текущее поведение.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareGroupTurn } from "../../.pi/extensions/telegram-bot/group-runtime.js";
import { evaluatePreFilter } from "../../.pi/extensions/user-rules/prefilter.js";
import {
  TelegramSessionPool,
} from "../../.pi/extensions/telegram-bot/TelegramSessionPool.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import type { UserRule } from "@griha/shared-types";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (event: unknown) => void;

class FakeAgentSession {
  listeners: Listener[] = [];
  prompts: string[] = [];
  lastText = "";
  disposed = false;
  sessionId = Math.random().toString(36).slice(2);

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(message: string): Promise<void> {
    this.prompts.push(message);
    this.lastText = `ответ на: ${message}`;
    for (const l of [...this.listeners]) l({ type: "agent_end", messages: [], willRetry: false });
  }

  getLastAssistantText(): string {
    return this.lastText;
  }

  get isStreaming(): boolean {
    return false;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function makeTurnDeps(opts: {
  rules?: UserRule[];
  isGroupConfigured?: (chatId: string) => boolean;
  hardRulesCalls?: string[];
}) {
  const rules = opts.rules ?? [];
  return {
    deps: {
      isGroupConfigured: opts.isGroupConfigured ?? (() => true),
      getHardRules: (chatId: string) => {
        opts.hardRulesCalls?.push(chatId);
        return rules;
      },
      getSoftRules: () => [],
      evaluate: (r: UserRule[], i: Parameters<typeof evaluatePreFilter>[1]) =>
        evaluatePreFilter(r, i),
      formatRules: () => "[правила чата]",
    },
    input: (threadId: string, extra: Record<string, unknown> = {}) => ({
      chatId: "-1005",
      userId: "1",
      threadId,
      chatType: "supergroup",
      isGroup: true,
      text: "обычное сообщение",
      groupConfigured: true,
      ...extra,
    }),
  };
}

describe("policy-per-chat contract (PROMPT 9)", () => {
  it("sessions: разные темы одного чата — РАЗНЫЕ сессии; /new одной темы не трогает другую", async () => {
    const created: FakeAgentSession[] = [];
    const pool = new TelegramSessionPool({
      sessionFactory: async () => {
        const s = new FakeAgentSession();
        created.push(s);
        return s as unknown as AgentSession;
      },
    });
    await pool.handleMessage("tg:1:-100:t:10", 1, "в тему 10", { chatId: "-100", threadId: "10" });
    await pool.handleMessage("tg:1:-100:t:11", 1, "в тему 11", { chatId: "-100", threadId: "11" });

    assert.equal(created.length, 2, "темы имеют отдельные AgentSession");
    assert.deepEqual(created[0]!.prompts, ["в тему 10"]);
    assert.deepEqual(created[1]!.prompts, ["в тему 11"]);

    // /new в теме 10 — тема 11 не затрагивается.
    await pool.reset("tg:1:-100:t:10");
    assert.equal(created[0]!.disposed, true);
    assert.equal(created[1]!.disposed, false, "сессия другой темы жива");

    await pool.handleMessage("tg:1:-100:t:10", 1, "после /new", { chatId: "-100", threadId: "10" });
    assert.equal(created.length, 3, "тема 10 получила новую сессию");
  });

  it("policy: правила чата применяются одинаково к ОБЕИМ темам (require_mention)", () => {
    const hardRulesCalls: string[] = [];
    const { deps, input } = makeTurnDeps({
      rules: [{ key: "require_mention", value: true } as UserRule],
      hardRulesCalls,
    });
    const a = prepareGroupTurn(input("10"), deps);
    const b = prepareGroupTurn(input("11"), deps);
    assert.equal(a.process, false);
    assert.equal(b.process, false);
    assert.equal(a.blockReason, "require_mention");
    assert.equal(b.blockReason, "require_mention");
    // Правила грузятся только по chatId — thread в lookup не участвует.
    assert.deepEqual([...new Set(hardRulesCalls)], ["-1005"]);
  });

  it("rulesContext: один и тот же контекст правил для каждой темы", () => {
    const { deps, input } = makeTurnDeps({});
    const a = prepareGroupTurn(input("10"), deps);
    const b = prepareGroupTurn(input("11"), deps);
    assert.equal(a.process, true);
    assert.equal(b.process, true);
    assert.equal(a.rulesContext, "[правила чата]");
    assert.equal(b.rulesContext, a.rulesContext, "контекст правил — chat-level, не per-topic");
  });

  it("onboarding: pending-чат молчит во ВСЕХ темах (настройка — на чат)", () => {
    const { deps, input } = makeTurnDeps({ isGroupConfigured: () => false });
    const a = prepareGroupTurn(input("10"), deps);
    const b = prepareGroupTurn(input("11"), deps);
    assert.equal(a.process, false);
    assert.equal(b.process, false);
    assert.equal(a.blockReason, "group-not-configured");
    assert.equal(b.blockReason, "group-not-configured");
  });

  it("routing: sessionKey темы уникален, ответ уходит в тему входящего", async () => {
    const seen: Array<{ sessionKey: string; threadId?: string }> = [];
    const sent: Array<{ text: string; threadId?: string }> = [];
    const bridge = new TelegramBridge(
      [1],
      async (input) => {
        seen.push({ sessionKey: input.sessionKey, threadId: input.threadId });
        return { text: "ок" };
      },
      async (_chatId, text, _filePath, extra) => {
        sent.push({ text, threadId: extra?.threadId });
      },
    );
    const update = (threadId: string) => ({
      updateId: Number(threadId),
      message: {
        from: { id: 1 },
        chat: { id: -100, type: "supergroup" },
        groupConfigured: true,
        threadId,
        text: "в теме",
      },
    });
    await bridge.handleUpdate(update("10"));
    await bridge.handleUpdate(update("11"));

    assert.deepEqual(
      seen.map((s) => s.sessionKey),
      ["tg:1:-100:t:10", "tg:1:-100:t:11"],
      "сессии изолированы по теме",
    );
    assert.deepEqual(seen.map((s) => s.threadId), ["10", "11"]);
    assert.deepEqual(
      sent.map((s) => s.threadId),
      ["10", "11"],
      "ответы — в свою тему",
    );
  });
});
