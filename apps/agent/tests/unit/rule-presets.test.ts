import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserRule } from "@griha/shared-types";
import {
  PRESETS,
  buildOnboardingKeyboard,
  parseCustomRulesText,
  presetRulesWithActor,
  type PresetId,
} from "../../.pi/extensions/chat-setup/RulePresets.js";
import { evaluatePreFilter, shouldProcessMessage } from "../../.pi/extensions/user-rules/prefilter.js";

describe("RulePresets", () => {
  it("every PresetId exists and has non-empty rules", () => {
    const ids = Object.keys(PRESETS) as PresetId[];
    assert.ok(ids.length >= 6);
    for (const id of ids) {
      assert.ok(PRESETS[id].rules.length > 0, `${id} rules empty`);
      assert.ok(PRESETS[id].title.length > 0);
    }
  });

  it("safe_default has require_mention=true", () => {
    const rule = PRESETS.safe_default.rules.find((r) => r.key === "require_mention");
    assert.deepEqual(rule, { key: "require_mention", value: true, kind: "hard" });
  });

  it("listener has listen_only=true", () => {
    const rule = PRESETS.listener.rules.find((r) => r.key === "listen_only");
    assert.equal(rule?.value, true);
  });

  it("only_me has only_my_messages=true", () => {
    const rule = PRESETS.only_me.rules.find((r) => r.key === "only_my_messages");
    assert.equal(rule?.value, true);
  });

  it("parseCustomRulesText: «только мои сообщения» → only_my_messages + user id", () => {
    const rules = parseCustomRulesText("Отвечай только мои сообщения и кратко", "111");
    const onlyMy = rules.find((r) => r.key === "only_my_messages");
    const userId = rules.find((r) => r.key === "only_my_messages_user_id");
    assert.equal(onlyMy?.value, true);
    assert.equal(userId?.value, "111");
  });

  it("parseCustomRulesText: «кратко» → length short; safe_default остаётся базой", () => {
    const rules = parseCustomRulesText("пиши кратко", "111");
    assert.equal(rules.find((r) => r.key === "length")?.value, "short");
    assert.equal(rules.find((r) => r.key === "require_mention")?.value, true);
  });

  it("presetRulesWithActor: only_me добавляет only_my_messages_user_id", () => {
    const rules = presetRulesWithActor("only_me", "222");
    assert.equal(rules.find((r) => r.key === "only_my_messages_user_id")?.value, "222");
    const team = presetRulesWithActor("team", "222");
    assert.equal(team.find((r) => r.key === "only_my_messages_user_id"), undefined);
  });

  it("callback data fits Telegram 64-byte limit", () => {
    const keyboard = buildOnboardingKeyboard("-1001234567890");
    for (const row of keyboard) {
      for (const button of row) {
        assert.ok(button.callbackData.length <= 64, `${button.callbackData} слишком длинный`);
        assert.ok(button.callbackData.startsWith("cs:-1001234567890:"));
      }
    }
  });
});

describe("pre-filter structured keys (§9)", () => {
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

  const groupInput = (extra: Record<string, unknown> = {}) => ({
    chatId: "-100",
    fromUserId: "1",
    text: "привет",
    isGroup: true,
    ...extra,
  });

  it("listen_only без обращения: агент заблокирован, архив разрешён", () => {
    const rules = [rule("listen_only", true)];
    assert.equal(shouldProcessMessage(rules, groupInput()), false, "агент не вызывается");
    const gate = evaluatePreFilter(rules, groupInput());
    assert.equal(gate.process, false);
    assert.equal(gate.suppressReply, true);
    assert.equal(gate.archive, true);
  });

  it("listen_only + @mention → агент разрешён и отвечает", () => {
    const rules = [rule("listen_only", true)];
    const gate = evaluatePreFilter(rules, groupInput({ botMentioned: true }));
    assert.equal(gate.process, true);
    assert.equal(gate.suppressReply, false);
  });

  it("listen_only + reply боту → агент разрешён (спека listen-only OCR)", () => {
    const rules = [rule("listen_only", true)];
    const gate = evaluatePreFilter(rules, groupInput({ repliedToBot: true }));
    assert.equal(gate.process, true);
    assert.equal(gate.suppressReply, false);
  });

  it("listen_only: боты и сервисные по-прежнему игнорируются", () => {
    const rules = [rule("listen_only", true), rule("ignore_bots", true), rule("ignore_service", true)];
    assert.equal(evaluatePreFilter(rules, groupInput({ fromIsBot: true })).process, false);
    assert.equal(evaluatePreFilter(rules, groupInput({ isService: true })).process, false);
    // Обычное сообщение без mention — агент заблокирован, но архив разрешён.
    const gate = evaluatePreFilter(rules, groupInput());
    assert.equal(gate.process, false);
    assert.equal(gate.archive, true);
  });

  it("listen_only + require_mention: без @mention агент не вызывается (архив отдельно)", () => {
    const rules = [
      rule("listen_only", true),
      rule("require_mention", true),
      rule("reply_to_bot", true),
    ];
    const gate = evaluatePreFilter(rules, groupInput());
    assert.equal(gate.process, false);
    assert.equal(gate.archive, true);
  });

  it("require_mention without mention → false", () => {
    const rules = [rule("require_mention", true), rule("reply_to_bot", true)];
    assert.equal(shouldProcessMessage(rules, groupInput()), false);
  });

  it("require_mention with @bot → true", () => {
    const rules = [rule("require_mention", true)];
    assert.equal(shouldProcessMessage(rules, groupInput({ botMentioned: true })), true);
  });

  it("require_mention passes a reply to the bot", () => {
    const rules = [rule("require_mention", true), rule("reply_to_bot", true)];
    assert.equal(shouldProcessMessage(rules, groupInput({ repliedToBot: true })), true);
  });

  it("only_my_messages: wrong user → false, actor → true", () => {
    const rules = [rule("only_my_messages", true), rule("only_my_messages_user_id", "42")];
    assert.equal(shouldProcessMessage(rules, groupInput({ fromUserId: "1" })), false);
    assert.equal(shouldProcessMessage(rules, groupInput({ fromUserId: "42" })), true);
  });

  it("ignore_if_other_mention: текст с чужим @ в начале → false", () => {
    const rules = [rule("ignore_if_other_mention", true)];
    assert.equal(shouldProcessMessage(rules, groupInput({ startsWithOtherMention: true })), false);
    assert.equal(shouldProcessMessage(rules, groupInput()), true);
  });

  it("без structured-правил legacy-эвристики работают как раньше", () => {
    const legacy: UserRule = {
      id: "l1",
      scope: "chat",
      chatId: "-100",
      ownerUserId: "42",
      text: "Отвечай только на мои сообщения",
      kind: "hard",
      enabled: true,
      createdAt: "t",
      updatedAt: "t",
    };
    assert.equal(shouldProcessMessage([legacy], groupInput({ fromUserId: "1" })), false);
    assert.equal(shouldProcessMessage([legacy], groupInput({ fromUserId: "42" })), true);
  });
});
