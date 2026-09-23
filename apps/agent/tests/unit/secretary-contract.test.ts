/**
 * S1 — контракт «Секретарь» (R-S1-1 … R-S1-4):
 * - pending группа → тишина;
 * - secretary/listen_only → ответ только на mention/reply (иначе тихий архив);
 * - private (DM) — control plane, group-правила не применяются.
 *
 * Проверяет существующий Layer-1 prefilter (не дублирует логику, а фиксирует её).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePreFilter,
  shouldProcessMessage,
} from "../../.pi/extensions/user-rules/prefilter.js";
import type { UserRule } from "@griha/shared-types";

const rule = (key: string, value: boolean | string, kind: "hard" | "soft" = "hard"): UserRule => ({
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

const group = (extra: Record<string, unknown> = {}) => ({
  chatId: "-100",
  fromUserId: "1",
  text: "завтра созвон в 14:00",
  isGroup: true,
  ...extra,
});

test("R-S1-1: pending группа + текст → not processable (group-not-configured)", () => {
  const gate = evaluatePreFilter([], group({ groupConfigured: false }));
  assert.equal(gate.process, false);
  assert.equal(shouldProcessMessage([], group({ groupConfigured: false })), false);
  assert.match(gate.reason ?? "", /group-not-configured/);
});

test("R-S1-2: secretary (listen_only) + текст без mention → block + тихий архив", () => {
  const gate = evaluatePreFilter([rule("listen_only", true)], group());
  assert.equal(gate.process, false);
  assert.equal(gate.suppressReply, true);
  assert.equal(gate.archive, true);
  assert.equal(shouldProcessMessage([rule("listen_only", true)], group()), false);
});

test("R-S1-3: secretary + @mention → allow (отвечает)", () => {
  const gate = evaluatePreFilter([rule("listen_only", true)], group({ botMentioned: true }));
  assert.equal(gate.process, true);
  assert.equal(gate.suppressReply, false);
});

test("R-S1-4: private chat → allow (require_mention не применяется к DM)", () => {
  const gate = evaluatePreFilter([rule("require_mention", true)], {
    chatId: "123",
    fromUserId: "1",
    text: "привет",
    isGroup: false,
  });
  assert.equal(gate.process, true);
});
