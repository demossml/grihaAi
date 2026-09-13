/**
 * Item 3.1 (C1): estimateTokens + getActualUsage + budget.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateMessageTokens,
  estimateTokens,
  getActualUsage,
  usableBudget,
} from "../../src/runtime/context/usage.js";

describe("Token accounting (Item 3.1)", () => {
  it("estimateTokens: ASCII ~4 симв/токен", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("hello world"), 3); // 11 симв → ceil(11/4)=3
    assert.equal(estimateTokens("a".repeat(8)), 2);
  });

  it("estimateTokens: CJK посимвольно", () => {
    assert.equal(estimateTokens("你好"), 2);
    assert.equal(estimateTokens("Привет"), 2); // кириллица → ceil(6/4)=2
  });

  it("estimateMessageTokens включает роль", () => {
    const m = { role: "user", content: "hi" };
    assert.equal(estimateMessageTokens(m), estimateTokens("user") + estimateTokens("hi") + 4);
  });

  it("getActualUsage: anchor провайдера выигрывает", () => {
    const messages = [{ role: "user", content: "hello" }];
    const usage = getActualUsage(messages, {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    assert.deepEqual(usage, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  });

  it("getActualUsage: без anchor — оценка, completion 0", () => {
    const messages = [{ role: "user", content: "hello" }];
    const usage = getActualUsage(messages);
    assert.equal(usage.completionTokens, 0);
    assert.equal(usage.totalTokens, usage.promptTokens);
    assert.ok((usage.promptTokens ?? 0) > 0);
  });

  it("getActualUsage: нулевой totalTokens в anchor игнорируется", () => {
    const messages = [{ role: "user", content: "hello" }];
    const usage = getActualUsage(messages, { totalTokens: 0, promptTokens: 999 });
    assert.equal(usage.totalTokens, usage.promptTokens);
  });

  it("usableBudget: резерв вычитается, не уходит в минус", () => {
    assert.equal(usableBudget({ maxTokens: 1000, reservedTokens: 200 }), 800);
    assert.equal(usableBudget({ maxTokens: 100, reservedTokens: 200 }), 0);
  });
});
