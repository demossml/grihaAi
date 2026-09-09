import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractThreadIdFromMessage,
  normalizeThreadId,
} from "../../.pi/extensions/telegram-bot/threads.js";
import { resolveExpensesScope } from "../../src/services/documents/expensesTools.js";

describe("thread id helpers", () => {
  it("normalizeThreadId: undefined/null/'' → undefined", () => {
    assert.equal(normalizeThreadId(undefined), undefined);
    assert.equal(normalizeThreadId(null), undefined);
    assert.equal(normalizeThreadId(""), undefined);
  });

  it("normalizeThreadId: number/string → строка", () => {
    assert.equal(normalizeThreadId(123), "123");
    assert.equal(normalizeThreadId("55"), "55");
  });

  it("extract из message_thread_id", () => {
    assert.equal(extractThreadIdFromMessage({ message_thread_id: 10 }), "10");
  });

  it("extract fallback из reply_to_message", () => {
    assert.equal(
      extractThreadIdFromMessage({ reply_to_message: { message_thread_id: 7 } }),
      "7",
    );
    assert.equal(extractThreadIdFromMessage({}), undefined);
  });
});

describe("resolveExpensesScope", () => {
  it("ctx thread + без scope → фильтр по теме", () => {
    assert.deepEqual(resolveExpensesScope({ ctxThreadId: "10" }), { threadId: "10" });
  });

  it("scope=chat → без фильтра темы", () => {
    assert.deepEqual(resolveExpensesScope({ ctxThreadId: "10", scopeArg: "chat" }), {
      threadId: undefined,
    });
  });

  it("scope=thread → тема из контекста", () => {
    assert.deepEqual(resolveExpensesScope({ ctxThreadId: "10", scopeArg: "thread" }), {
      threadId: "10",
    });
  });

  it("без ctx темы → без фильтра темы", () => {
    assert.deepEqual(resolveExpensesScope({}), { threadId: undefined });
  });

  it("явный threadId-аргумент побеждает (пустой = весь чат)", () => {
    assert.deepEqual(resolveExpensesScope({ ctxThreadId: "10", threadIdArg: "22" }), {
      threadId: "22",
    });
    assert.deepEqual(resolveExpensesScope({ ctxThreadId: "10", threadIdArg: "" }), {
      threadId: undefined,
    });
  });
});
