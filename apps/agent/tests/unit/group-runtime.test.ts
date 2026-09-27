import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserRule } from "@griha/shared-types";
import {
  prepareGroupTurn,
  processInboundMessage,
  shouldNotifyPoorOcr,
  type PipelineDeps,
  type PrepareTurnDeps,
} from "../../.pi/extensions/telegram-bot/group-runtime.js";
import { evaluatePreFilter } from "../../.pi/extensions/user-rules/prefilter.js";
import { formatRulesContext } from "../../.pi/extensions/user-rules/format-rules-context.js";
import { initObs, resetObsForTests } from "@griha/observability";
import type { ObsEvent, ObsSink } from "@griha/observability";

const rule = (key: string, value: string | boolean, kind: "hard" | "soft" = "hard"): UserRule => ({
  id: `r-${key}`,
  scope: "chat",
  chatId: "-100",
  text: `${key} = ${String(value)}`,
  kind,
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  key,
  value,
});

function makeDeps(overrides: Partial<PrepareTurnDeps> = {}): PrepareTurnDeps {
  return {
    isGroupConfigured: (chatId) => chatId === "-100",
    getHardRules: () => [rule("require_mention", true)],
    getSoftRules: () => [rule("length", "short", "soft")],
    evaluate: (rules, input) => evaluatePreFilter(rules, input),
    formatRules: (hard, soft) => formatRulesContext(hard, soft),
    ...overrides,
  };
}

const groupCtx = (extra: Record<string, unknown> = {}) => ({
  chatId: "-100",
  userId: "42",
  chatType: "supergroup",
  isGroup: true,
  text: "привет",
  ...extra,
});

describe("processInboundMessage (Group Runtime Contract)", () => {
  function makePipelineDeps(calls: {
    agent?: (input: { message: string; rulesContext: string }) => Promise<{ text: string }>;
    sent?: string[];
    allowed?: boolean;
    configured?: boolean;
    hard?: UserRule[];
    soft?: UserRule[];
  } = {}): PipelineDeps {
    return {
      isAllowed: async () => calls.allowed ?? true,
      isGroupConfigured: () => calls.configured ?? true,
      getHardRules: () => calls.hard ?? [rule("require_mention", true)],
      getSoftRules: () => calls.soft ?? [rule("length", "short", "soft")],
      evaluate: (rules, input) => evaluatePreFilter(rules, input),
      formatRules: (hard, soft) => formatRulesContext(hard, soft),
      runAgent: async (input) => calls.agent?.(input) ?? { text: "ответ" },
      send: async (_chatId, text) => {
        calls.sent?.push(text);
      },
    };
  }

  it("1: не настроенная группа → silent, агент не вызван", async () => {
    let agentCalls = 0;
    const deps = makePipelineDeps({ configured: false, agent: async () => ({ text: "x" }) });
    const res = await processInboundMessage(groupCtx(), {
      ...deps,
      runAgent: async (input) => {
        agentCalls++;
        return { text: "x" };
      },
    });
    assert.deepEqual(res, { action: "silent", reason: "group-not-configured" });
    assert.equal(agentCalls, 0);
  });

  it("2: configured + require_mention без mention → silent", async () => {
    const res = await processInboundMessage(groupCtx(), makePipelineDeps());
    assert.deepEqual(res, { action: "silent", reason: "prefilter" });
  });

  it("3: configured + mention → агент с rulesContext [GROUP_RULES]", async () => {
    let seen: { message: string; rulesContext: string; sessionKey: string } | null = null;
    const res = await processInboundMessage(
      groupCtx({ botMentioned: true, text: "@bot привет" }),
      makePipelineDeps({
        agent: async (input) => {
          seen = { message: input.message, rulesContext: input.rulesContext, sessionKey: (input as unknown as { sessionKey: string }).sessionKey };
          return { text: "ответ" };
        },
      }),
    );
    assert.equal(res.action, "replied");
    assert.ok(seen!.rulesContext.includes("[GROUP_RULES]"));
    assert.ok(seen!.rulesContext.includes("- length=short"));
    assert.ok(seen!.sessionKey.startsWith("tg:42:-100"));
  });

  it("4: ACL deny → silent", async () => {
    const res = await processInboundMessage(groupCtx(), makePipelineDeps({ allowed: false }));
    assert.deepEqual(res, { action: "silent", reason: "acl-denied" });
  });

  it("5: голос → STT, агент получает транскрипт", async () => {
    let agentMessage = "";
    const res = await processInboundMessage(
      groupCtx({ botMentioned: true, voiceFileId: "v1", text: "" }),
      {
        ...makePipelineDeps(),
        transcribeVoice: async () => "распознанный текст",
        runAgent: async (input) => {
          agentMessage = input.message;
          return { text: "ок" };
        },
      },
    );
    assert.equal(res.action, "replied");
    assert.equal(agentMessage, "распознанный текст");
  });

  it("6: private чат — groupConfigured не проверяется", async () => {
    const res = await processInboundMessage(
      { chatId: "77", userId: "42", chatType: "private", isGroup: false, text: "привет" },
      makePipelineDeps({ configured: false }),
    );
    assert.equal(res.action, "replied", "private не блокируется configured=false");
  });
});

describe("prepareGroupTurn", () => {
  it("pending группа → blocked, агент не вызывается", () => {
    const res = prepareGroupTurn(groupCtx(), makeDeps({ isGroupConfigured: () => false }));
    assert.equal(res.process, false);
    assert.equal(res.reason, "group-not-configured");
  });

  it("configured + mention → rulesContext присутствует", () => {
    const res = prepareGroupTurn(groupCtx({ botMentioned: true }), makeDeps());
    assert.equal(res.process, true);
    assert.ok(res.rulesContext.includes("[GROUP_RULES]"));
  });
});

describe("S4 scenario secretary (belt listen_only)", () => {
  it("secretary + обычный текст → archive/suppress, агент НЕ вызывается", () => {
    const res = prepareGroupTurn(
      groupCtx(),
      makeDeps({ getHardRules: () => [], getScenario: () => "secretary" }),
    );
    assert.equal(res.process, false);
    assert.equal(res.archive, true);
    assert.equal(res.suppressReply, true);
    assert.equal(res.blockReason, "listen_only");
  });

  it("secretary + mention → агент разрешён", () => {
    const res = prepareGroupTurn(
      groupCtx({ botMentioned: true }),
      makeDeps({ getHardRules: () => [], getScenario: () => "secretary" }),
    );
    assert.equal(res.process, true);
  });

  it("secretary + pending → ни агента, ни архива", () => {
    const res = prepareGroupTurn(
      groupCtx(),
      makeDeps({ isGroupConfigured: () => false, getScenario: () => "secretary" }),
    );
    assert.equal(res.process, false);
    assert.equal(res.archive, false);
    assert.equal(res.suppressReply, false);
    assert.equal(res.reason, "group-not-configured");
  });

  it("secretary + archived → ни агента, ни архива", () => {
    // archived → isGroupConfigured false (как не настроена).
    const res = prepareGroupTurn(
      groupCtx(),
      makeDeps({ isGroupConfigured: () => false, getScenario: () => "secretary" }),
    );
    assert.equal(res.process, false);
    assert.equal(res.archive, false);
    assert.equal(res.suppressReply, false);
  });

  it("без сценария (нет getScenario) → поведение 1:1 не меняется", () => {
    const res = prepareGroupTurn(groupCtx(), makeDeps());
    assert.equal(res.process, false, "require_mention без mention → prefilter silent");
    assert.equal(res.blockReason, "require_mention");
  });
});

describe("shouldNotifyPoorOcr (R-GR-8)", () => {
  it("флаг false (default) → не уведомляем", () => {
    assert.equal(shouldNotifyPoorOcr([], { needsReview: true }), false);
    assert.equal(
      shouldNotifyPoorOcr([rule("notify_poor_ocr", false)], { needsReview: true }),
      false,
    );
  });

  it("флаг true + низкий confidence → уведомить", () => {
    assert.equal(
      shouldNotifyPoorOcr([rule("notify_poor_ocr", true)], { confidence: 0.1 }),
      true,
    );
    assert.equal(
      shouldNotifyPoorOcr([rule("notify_poor_ocr", true)], { needsReview: true, confidence: 0.9 }),
      true,
    );
  });

  it("флаг true + высокий confidence → молчать", () => {
    assert.equal(
      shouldNotifyPoorOcr([rule("notify_poor_ocr", true)], { confidence: 0.8 }),
      false,
    );
  });
});

describe("gate emit mention diagnostics", () => {
  function captured(): ObsEvent[] {
    const list: ObsEvent[] = [];
    const sink: ObsSink = { write(e) { list.push(e); } };
    delete process.env.GRIHA_OBS;
    resetObsForTests();
    initObs({ sink });
    return list;
  }

  it("gate.allow data содержит mention-диагностику (entity + textual)", () => {
    const list = captured();
    const res = prepareGroupTurn(
      groupCtx({
        botMentioned: true,
        entityMention: true,
        textualMention: false,
        botUsername: "griha_ai_bot",
        entityCount: 1,
      }),
      makeDeps({ getHardRules: () => [] }), // без правил → allow
    );
    assert.equal(res.process, true);
    const allow = list.find((e) => e.event === "gate.allow");
    assert.ok(allow, "gate.allow есть");
    const d = allow.data as Record<string, unknown>;
    assert.equal(d.botMentioned, true);
    assert.equal(d.entityMention, true);
    assert.equal(d.textualMention, false);
    assert.equal(d.botUsername, "griha_ai_bot");
    assert.equal(d.entityCount, 1);
    resetObsForTests();
  });

  it("gate.block (listen_only) data содержит botMentioned:false + repliedToBot", () => {
    const list = captured();
    const res = prepareGroupTurn(
      groupCtx({ botMentioned: false, repliedToBot: false, entityMention: false, textualMention: false, entityCount: 0 }),
      makeDeps({ getHardRules: () => [rule("listen_only", true)] }),
    );
    assert.equal(res.process, false);
    const block = list.find((e) => e.event === "gate.block");
    assert.ok(block, "gate.block есть");
    const d = block.data as Record<string, unknown>;
    assert.equal(d.reason, "listen_only");
    assert.equal(d.botMentioned, false);
    assert.equal(d.repliedToBot, false);
    assert.equal(d.entityMention, false);
    assert.equal(d.textualMention, false);
    assert.equal(d.entityCount, 0);
    resetObsForTests();
  });

  it("textual fallback: @username без entity → botMentioned true → listen_only пропускает", () => {
    const list = captured();
    // Эмуляция: normalizer уже применил fallback (textualMention=true → botMentioned=true).
    const res = prepareGroupTurn(
      groupCtx({ botMentioned: true, entityMention: false, textualMention: true, botUsername: "griha_ai_bot", entityCount: 0 }),
      makeDeps({ getHardRules: () => [rule("listen_only", true)] }),
    );
    assert.equal(res.process, true, "listen_only + textual mention → allow");
    const allow = list.find((e) => e.event === "gate.allow");
    const d = allow!.data as Record<string, unknown>;
    assert.equal(d.textualMention, true);
    resetObsForTests();
  });
});
