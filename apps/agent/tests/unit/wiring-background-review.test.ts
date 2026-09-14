/**
 * G1 (post-wiring): фоновый review хода за флагом.
 * off = никогда не вызывается; on = триггер → LLM (models.learning) → уроки;
 * ошибки LLM не ломают turn; результат — событие learning в observability.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GrishAiConfig } from "@griha/shared-types";
import {
  maybeBackgroundReview,
  parseReviewLessons,
} from "../../.pi/extensions/core-agent/background-review.js";
import { runtimeObservability } from "../../src/utils/routing/runtime-observability.js";
import type { LearningLlm } from "../../src/utils/learning/learning-extractor.js";

const ON: NodeJS.ProcessEnv = { GRIHA_AGENT_RUNTIME: "1" };
const OFF: NodeJS.ProcessEnv = {};

function cfg(): GrishAiConfig {
  return {
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "k",
    setupCompletedAt: "2026-01-01",
  };
}

function llmReturning(raw: string): LearningLlm {
  return async () => raw;
}

describe("G1: background review wiring", () => {
  it("флаг off → null, LLM не вызывается", async () => {
    let calls = 0;
    const result = await maybeBackgroundReview(
      { turnIndex: 1, usedTools: false, hadError: true },
      { config: cfg(), env: OFF, llm: async () => { calls++; return "[]"; } },
    );
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  it("config отсутствует → null", async () => {
    const result = await maybeBackgroundReview(
      { turnIndex: 1, usedTools: false, hadError: true },
      { config: null, env: ON, llm: llmReturning("[]") },
    );
    assert.equal(result, null);
  });

  it("триггер не сработал → null, LLM не вызывается", async () => {
    let calls = 0;
    const result = await maybeBackgroundReview(
      { turnIndex: 1, usedTools: false, hadError: false },
      { config: cfg(), env: ON, llm: async () => { calls++; return "[]"; } },
    );
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  it("ход с ошибкой → LLM вызван, уроки распарсены", async () => {
    const raw =
      'разбор:\n[{"kind":"factual","content":"Провайдер X требует apiKey"},' +
      '{"kind":"unknown","content":"надо проверить"}]';
    const result = await maybeBackgroundReview(
      { turnIndex: 3, usedTools: false, hadError: true },
      { config: cfg(), env: ON, llm: llmReturning(raw), now: () => "2026-09-13T00:00:00Z" },
    );
    assert.ok(result);
    assert.equal(result.turnIndex, 3);
    assert.equal(result.createdAt, "2026-09-13T00:00:00Z");
    assert.deepEqual(result.lessons, [
      { content: "Провайдер X требует apiKey", kind: "factual" },
      { content: "надо проверить", kind: "unknown" },
    ]);
  });

  it("плановый review на turn 10 по дефолтной политике", async () => {
    const result = await maybeBackgroundReview(
      { turnIndex: 10, usedTools: false, hadError: false },
      { config: cfg(), env: ON, llm: llmReturning("[]") },
    );
    assert.ok(result);
    assert.equal(result.turnIndex, 10);
    assert.equal(result.lessons.length, 0);
  });

  it("бюджет maxLessons ограничивает число уроков", async () => {
    const raw = JSON.stringify([
      { kind: "factual", content: "1" },
      { kind: "factual", content: "2" },
      { kind: "factual", content: "3" },
      { kind: "factual", content: "4" },
    ]);
    const result = await maybeBackgroundReview(
      { turnIndex: 1, usedTools: true, hadError: false },
      { config: cfg(), env: ON, llm: llmReturning(raw), maxLessons: 2 },
    );
    assert.ok(result);
    assert.equal(result.lessons.length, 2);
  });

  it("LLM бросает → null (turn не ломается)", async () => {
    const result = await maybeBackgroundReview(
      { turnIndex: 1, usedTools: true, hadError: false },
      {
        config: cfg(),
        env: ON,
        llm: async () => {
          throw new Error("provider down");
        },
      },
    );
    assert.equal(result, null);
  });

  it("parseReviewLessons: мусор вокруг JSON, невалидный JSON → []", () => {
    assert.deepEqual(
      parseReviewLessons('текст [{"kind":"preference","content":"любит короткие ответы"}] хвост'),
      [{ content: "любит короткие ответы", kind: "preference" }],
    );
    assert.deepEqual(parseReviewLessons("no json here"), []);
    assert.deepEqual(parseReviewLessons("[{не json]"), []);
    assert.deepEqual(parseReviewLessons('{"kind":"factual","content":"не массив"}'), []);
    // невалидный kind → unknown; пустой content пропускается
    assert.deepEqual(
      parseReviewLessons('[{"kind":"weird","content":"x"},{"kind":"factual","content":"  "}]'),
      [{ content: "x", kind: "unknown" }],
    );
  });

  it("observability: backgroundReview пишет событие learning", () => {
    const correlationId = runtimeObservability.backgroundReview(7, 3);
    const counts = runtimeObservability.buffer.countByKind(correlationId);
    assert.equal(counts.get("learning"), 1);
  });
});
