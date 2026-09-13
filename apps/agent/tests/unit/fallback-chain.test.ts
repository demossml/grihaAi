/**
 * Item 2.3 (B3): классификация ошибок + FallbackChain.
 * Политики: 429/5xx/сеть/timeout → next; 401/403/context-overflow/unknown → стоп.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelConfig } from "@griha/shared-types";
import { FallbackChain, classifyError } from "../../src/runtime/model/fallback-chain.js";

const m = (model: string): ModelConfig => ({ provider: "deepseek", model });

describe("classifyError (Item 2.3)", () => {
  it("401/403 → auth; 429 → rate-limit; 5xx → server", () => {
    assert.equal(classifyError({ status: 401 }), "auth");
    assert.equal(classifyError({ statusCode: 403 }), "auth");
    assert.equal(classifyError({ status: 429 }), "rate-limit");
    assert.equal(classifyError({ status: 500 }), "server");
    assert.equal(classifyError({ status: 503 }), "server");
  });

  it("context-overflow по контенту сообщения", () => {
    assert.equal(
      classifyError(new Error("This model's maximum context length is 128000 tokens")),
      "context-overflow",
    );
    assert.equal(
      classifyError(new Error("prompt is too long: token limit exceeded")),
      "context-overflow",
    );
  });

  it("timeout/network по паттернам; мусор → unknown", () => {
    assert.equal(classifyError(new Error("Request timed out")), "timeout");
    assert.equal(classifyError(new Error("ECONNRESET socket hang up")), "network");
    assert.equal(classifyError(new Error("weird failure")), "unknown");
    assert.equal(classifyError(undefined), "unknown");
  });

  it("статус из axios-подобного response.status", () => {
    assert.equal(classifyError({ response: { status: 429 } }), "rate-limit");
  });
});

describe("FallbackChain (Item 2.3)", () => {
  const chain = new FallbackChain([m("deepseek-v4-pro"), m("deepseek-v4-flash"), m("gpt-x")]);

  it("429/5xx/network/timeout → следующий кандидат", () => {
    assert.equal(chain.nextAfter(0, "rate-limit"), 1);
    assert.equal(chain.nextAfter(1, "server"), 2);
    assert.equal(chain.nextAfter(0, "network"), 1);
    assert.equal(chain.nextAfter(1, "timeout"), 2);
  });

  it("auth/context-overflow/unknown → стоп (корреляция сохраняется)", () => {
    assert.equal(chain.nextAfter(0, "auth"), null);
    assert.equal(chain.nextAfter(0, "context-overflow"), null);
    assert.equal(chain.nextAfter(0, "unknown"), null);
  });

  it("конец пула → null; индексы вне диапазона → null", () => {
    assert.equal(chain.nextAfter(2, "server"), null);
    assert.equal(chain.nextAfter(-1, "server"), null);
    assert.equal(chain.nextAfter(3, "server"), null);
  });

  it("каждый кандидат используется максимум один раз (индекс строго растёт)", () => {
    let idx = 0;
    for (let i = 0; i < 10; i++) {
      const next = chain.nextAfter(idx, "server");
      if (next === null) break;
      assert.ok(next > idx);
      idx = next;
    }
    assert.equal(idx, 2);
  });

  it("pick возвращает конфиг по индексу", () => {
    assert.equal(chain.pick(0)?.model, "deepseek-v4-pro");
    assert.equal(chain.pick(5), undefined);
  });
});
