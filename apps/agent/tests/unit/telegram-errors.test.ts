import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSendDelayMs,
  parseTelegramError,
  shouldRetrySend,
} from "../../.pi/extensions/telegram-bot/telegram-errors.js";
import { ChatSendQueue } from "../../.pi/extensions/telegram-bot/send-queue.js";

describe("parseTelegramError", () => {
  it("429 + parameters.retry_after: 13 → retry_after 13", () => {
    const parsed = parseTelegramError({
      error_code: 429,
      description: "Too Many Requests: retry after 13",
      parameters: { retry_after: 13 },
    });
    assert.equal(parsed.kind, "retry_after");
    assert.equal(parsed.retryAfterSec, 13);
  });

  it("description 'retry after 7' без error_code → retry_after 7", () => {
    const parsed = parseTelegramError({
      description: "Too Many Requests: retry after 7",
    });
    assert.equal(parsed.kind, "retry_after");
    assert.equal(parsed.retryAfterSec, 7);
  });

  it("nested err.response с error_code 429 → retry_after", () => {
    const parsed = parseTelegramError({
      response: { error_code: 429, parameters: { retry_after: 3 } },
    });
    assert.equal(parsed.kind, "retry_after");
    assert.equal(parsed.retryAfterSec, 3);
  });

  it("403 → forbidden, ретраев нет", () => {
    const parsed = parseTelegramError({ error_code: 403, description: "Forbidden: bot was kicked" });
    assert.equal(parsed.kind, "forbidden");
    assert.equal(shouldRetrySend(parsed, 1, 5), false);
  });

  it("400 → bad_request", () => {
    const parsed = parseTelegramError({ error_code: 400, description: "Bad Request: can't parse entities" });
    assert.equal(parsed.kind, "bad_request");
    assert.equal(shouldRetrySend(parsed, 1, 5), false);
  });

  it("401 → unauthorized", () => {
    const parsed = parseTelegramError({ error_code: 401, description: "Unauthorized" });
    assert.equal(parsed.kind, "unauthorized");
  });

  it("502 → retryable", () => {
    const parsed = parseTelegramError({ error_code: 502, description: "Bad Gateway" });
    assert.equal(parsed.kind, "retryable");
    assert.equal(shouldRetrySend(parsed, 1, 5), true);
  });

  it("сетевые ошибки (ECONNRESET / fetch failed) → retryable", () => {
    assert.equal(parseTelegramError(new Error("ECONNRESET")).kind, "retryable");
    assert.equal(parseTelegramError(new Error("fetch failed")).kind, "retryable");
    assert.equal(parseTelegramError({ message: "ETIMEDOUT" }).kind, "retryable");
  });

  it("неизвестная ошибка → unknown, без ретраев", () => {
    const parsed = parseTelegramError(new Error("непонятная ошибка"));
    assert.equal(parsed.kind, "unknown");
    assert.equal(shouldRetrySend(parsed, 1, 5), false);
  });

  it("предел попыток: даже retryable не ретраится после последней", () => {
    const parsed = parseTelegramError({ error_code: 502 });
    assert.equal(shouldRetrySend(parsed, 5, 5), false);
    assert.equal(shouldRetrySend(parsed, 4, 5), true);
  });
});

describe("computeSendDelayMs", () => {
  it("retry_after 5 → >= 5000 и <= 5000*(1+jitterRatio)+eps", () => {
    for (let i = 0; i < 20; i++) {
      const ms = computeSendDelayMs({ kind: "retry_after", retryAfterSec: 5 }, 1, {
        jitterRatio: 0.2,
      });
      assert.ok(ms >= 5000, `ms=${ms} >= 5000`);
      assert.ok(ms <= 5000 * 1.2 + 1, `ms=${ms} <= 6001`);
    }
  });

  it("retryable — экспоненциальный рост", () => {
    const parsed = { kind: "retryable" as const };
    const d1 = computeSendDelayMs(parsed, 1, { baseMs: 1000, jitterRatio: 0 });
    const d2 = computeSendDelayMs(parsed, 2, { baseMs: 1000, jitterRatio: 0 });
    const d3 = computeSendDelayMs(parsed, 3, { baseMs: 1000, jitterRatio: 0 });
    assert.equal(d1, 1000);
    assert.equal(d2, 2000);
    assert.equal(d3, 4000);
  });

  it("forbidden/unknown → 0 (вызывающий не ретраит)", () => {
    assert.equal(computeSendDelayMs({ kind: "forbidden" }, 1), 0);
    assert.equal(computeSendDelayMs({ kind: "unknown" }, 1), 0);
  });
});

describe("ChatSendQueue", () => {
  it("два таска в одном chatId выполняются строго последовательно", async () => {
    const q = new ChatSendQueue();
    const order: string[] = [];
    const task = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
    };
    await Promise.all([
      q.enqueue("42", task("a", 15)),
      q.enqueue("42", task("b", 1)),
    ]);
    assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  });

  it("разные chatId не блокируют друг друга", async () => {
    const q = new ChatSendQueue();
    const order: string[] = [];
    const task = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
    };
    await Promise.all([
      q.enqueue("1", task("slow", 20)),
      q.enqueue("2", task("fast", 1)),
    ]);
    assert.ok(
      order.indexOf("fast:end") < order.indexOf("slow:end"),
      `fast чат не должен ждать slow: ${order.join(",")}`,
    );
  });

  it("ошибка предыдущего таска не блокирует следующий", async () => {
    const q = new ChatSendQueue();
    const results: string[] = [];
    await q.enqueue("42", async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    await q.enqueue("42", async () => {
      results.push("next");
    });
    assert.deepEqual(results, ["next"]);
  });
});
