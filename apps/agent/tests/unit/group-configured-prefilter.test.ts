import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserRule } from "@griha/shared-types";
import { evaluatePreFilter, shouldProcessMessage } from "../../.pi/extensions/user-rules/prefilter.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";

const hard = (key: string, value: string | boolean): UserRule => ({
  id: `r-${key}`,
  scope: "chat",
  chatId: "-100",
  text: `${key} = ${String(value)}`,
  kind: "hard",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  key,
  value,
});

const groupInput = (extra: Record<string, unknown> = {}) => ({
  chatId: "-100",
  fromUserId: "1",
  text: "привет",
  isGroup: true,
  ...extra,
});

describe("shouldProcessMessage: groupConfigured (R1/R6)", () => {
  it("R1: group + groupConfigured=false → false, даже с botMentioned", () => {
    assert.equal(shouldProcessMessage([], groupInput({ groupConfigured: false, botMentioned: true })), false);
  });

  it("R1: group + false + '@bot hello' → false (mention не спасает)", () => {
    assert.equal(
      shouldProcessMessage([], groupInput({ groupConfigured: false, text: "@bot hello" })),
      false,
    );
  });

  it("configured + require_mention + no mention → false", () => {
    const rules = [hard("require_mention", true)];
    assert.equal(shouldProcessMessage(rules, groupInput({ groupConfigured: true })), false);
  });

  it("configured + require_mention + botMentioned → true", () => {
    const rules = [hard("require_mention", true)];
    assert.equal(
      shouldProcessMessage(rules, groupInput({ groupConfigured: true, botMentioned: true })),
      true,
    );
  });

  it("R6: private + groupConfigured=false НЕ блокирует по groupConfigured", () => {
    assert.equal(
      shouldProcessMessage(
        [],
        { chatId: "77", fromUserId: "1", text: "привет", isGroup: false, groupConfigured: false },
      ),
      true,
    );
  });

  it("configured + listen_only → обрабатывается (архивариус), ответ подавлен", () => {
    const rules = [hard("listen_only", true)];
    assert.equal(shouldProcessMessage(rules, groupInput({ groupConfigured: true })), true);
    const gate = evaluatePreFilter(rules, groupInput({ groupConfigured: true }));
    assert.equal(gate.suppressReply, true);
    assert.equal(gate.archive, true);
  });
});

describe("TelegramBridge groupConfigured integration", () => {
  it("pending-группа: prefilter получает false → агент не вызывается", async () => {
    let agentCalled = false;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "x" };
      },
      async () => {},
      { prefilter: (_input) => shouldProcessMessage([], _input) },
    );

    const res = await bridge.handleUpdate({
      updateId: 40,
      message: {
        from: { id: 123 },
        chat: { id: -100, type: "group" },
        groupConfigured: false,
        text: "@bot привет",
        botMentioned: true,
      },
    });

    assert.equal(res.handled, true);
    assert.equal(res.reason, "blocked-by-rules");
    assert.equal(agentCalled, false, "pending-группа — 0 токенов LLM");
  });

  it("configured-группа + mention → агент вызван", async () => {
    let agentCalled = false;
    const bridge = new TelegramBridge(
      [123],
      async () => {
        agentCalled = true;
        return { text: "ok" };
      },
      async () => {},
      { prefilter: (_input) => shouldProcessMessage([], _input) },
    );

    const res = await bridge.handleUpdate({
      updateId: 41,
      message: {
        from: { id: 123 },
        chat: { id: -100, type: "group" },
        groupConfigured: true,
        text: "привет",
      },
    });

    assert.equal(res.handled, true);
    assert.equal(agentCalled, true);
  });

  it("private /start работает независимо от groupConfigured", async () => {
    const sent: string[] = [];
    const bridge = new TelegramBridge(
      [123],
      async () => ({ text: "x" }),
      async (_chatId, text) => {
        sent.push(text);
      },
      { prefilter: (_input) => shouldProcessMessage([], _input) },
    );

    const res = await bridge.handleUpdate({
      updateId: 42,
      message: { from: { id: 123 }, chat: { id: 99, type: "private" }, text: "/start" },
    });

    assert.equal(res.handled, true);
    assert.ok(sent[0].includes("Гриша"));
  });
});
