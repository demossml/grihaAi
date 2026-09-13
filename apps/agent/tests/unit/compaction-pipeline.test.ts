/**
 * C2 (матрица C2, §8) — 4-фазный конвейер компакции.
 * Phase 1 prune (tool results) → Phase 2 structural (head/middle/tail) →
 * Phase 3 summarize (шаблон или LLM) → Phase 4 merge (итеративная
 * ре-компрессия с предыдущим summary).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactContext,
  compactContextAsync,
  type CompactionPhaseRecord,
} from "../../src/runtime/context/pipeline.js";
import type { ChatMessage } from "../../src/runtime/context/usage.js";

function tool(i: number): ChatMessage {
  return { role: "tool", content: `result ${i}` };
}

describe("compactContext: 4-фазный конвейер (C2)", () => {
  it("все 4 фазы по порядку, Phase 1 вычищает старые tool-результаты", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "инструкции" },
      ...Array.from({ length: 10 }, (_, i) => tool(i)),
    ];
    const result = compactContext(messages, { recentTurns: 1 });
    assert.deepEqual(
      result.phases.map((p: CompactionPhaseRecord) => p.phase),
      [1, 2, 3, 4],
    );
    assert.equal(result.prunedCount, 2, "два самых старых результата вычищены");
    assert.equal(result.head.length, 1, "system сохранён");
    assert.equal(result.tail.length, 2, "последний turn сохранён");
    // 10 tools − 2 pruned − 2 в tail = 6 в середине (резюме).
    assert.equal(result.middleCount, 6, "6 оставшихся в резюме");
    assert.equal(
      result.phases[0]?.name,
      "prune",
    );
  });

  it("Phase 2: head=system-префикс, tail=последние 2*recentTurns сообщений", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "s1" },
      { role: "system", content: "s2" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
    const result = compactContext(messages, { recentTurns: 1 });
    assert.equal(result.head.length, 2);
    assert.deepEqual(result.tail.map((m) => m.content), ["u3", "a3"]);
    assert.equal(result.middleCount, 4);
  });

  it("Phase 3: шаблон извлекает decision и открытые вопросы из середины", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "цель: сделать X" },
      { role: "assistant", content: "decision: использовать Y" },
      { role: "user", content: "когда дедлайн?" },
      { role: "assistant", content: "прогресс: шаг 1" },
    ];
    const result = compactContext(messages, { recentTurns: 0 });
    assert.equal(result.summary.goal, "цель: сделать X");
    assert.ok(result.summary.decisions.includes("использовать Y"));
    assert.ok(result.summary.openQuestions.includes("когда дедлайн?"));
  });

  it("Phase 4: итеративное слияние с предыдущим summary (дедуп решений)", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "новая цель" },
      { role: "assistant", content: "decision: то же решение" },
    ];
    const previous = {
      goal: "старая цель",
      progress: "старый прогресс",
      decisions: ["то же решение", "старое решение"],
      openQuestions: ["старый вопрос?"],
    };
    const result = compactContext(messages, { recentTurns: 0, previousSummary: previous });
    assert.equal(result.summary.goal, "новая цель", "новый goal выигрывает");
    assert.deepEqual(
      [...result.summary.decisions].sort(),
      ["старое решение", "то же решение"],
      "решения не удваиваются",
    );
    assert.ok(result.summary.openQuestions.includes("старый вопрос?"));
    assert.equal(result.phases[3]?.name, "merge");
  });

  it("compactContextAsync: Phase 3 через LLM-колбэк (aux B5)", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "текст" },
      { role: "assistant", content: "ответ" },
    ];
    const llmSummarize = async (): Promise<{
      goal?: string;
      progress?: string;
      decisions: string[];
      openQuestions: string[];
    }> => ({
      goal: "LLM goal",
      progress: "LLM progress",
      decisions: ["llm decision"],
      openQuestions: [],
    });
    const result = await compactContextAsync(messages, { recentTurns: 1, llmSummarize });
    assert.equal(result.summary.goal, "LLM goal");
    assert.equal(result.summary.decisions.length, 1);
    assert.equal(result.phases.find((p) => p.phase === 3)?.detail, "LLM");
  });

  it("compactContextAsync без llmSummarize = шаблон (паритет с sync)", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "цель" },
      { role: "assistant", content: "decision: d1" },
    ];
    const result = await compactContextAsync(messages, { recentTurns: 0 });
    assert.equal(result.summary.goal, "цель");
    assert.ok(result.summary.decisions.includes("d1"));
    assert.equal(result.phases.find((p) => p.phase === 3)?.detail, "template");
  });
});
