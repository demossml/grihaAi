/**
 * Item 3.4 (C4): preserve/summarize/merge/persist/restore.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_PRIORITY,
  emptySummary,
  extractSummarySections,
  mergeSummaries,
  persistSummary,
  preserveRecentTurns,
  preserveSystemContext,
  renderSummary,
  restoreSummary,
  summarizeMiddle,
  type ChatMessage,
} from "../../src/runtime/context/summary.js";

const m = (role: string, content: string): ChatMessage => ({ role, content });

describe("Context summary (Item 3.4)", () => {
  it("CONTEXT_PRIORITY = порядок §8: system → security → ... → history", () => {
    assert.deepEqual([...CONTEXT_PRIORITY], [
      "system",
      "security",
      "task",
      "recent",
      "memory",
      "skills",
      "history",
    ]);
  });

  it("preserveSystemContext: только head-system-сообщения", () => {
    const input = [m("system", "s1"), m("system", "s2"), m("user", "u"), m("system", "s3")];
    assert.deepEqual(preserveSystemContext(input), [input[0], input[1]]);
  });

  it("preserveRecentTurns: последние 2n сообщений", () => {
    const input = [m("u", "1"), m("a", "2"), m("u", "3"), m("a", "4"), m("u", "5"), m("a", "6")];
    const tail = preserveRecentTurns(input, 2);
    assert.deepEqual(tail.map((x) => x.content), ["3", "4", "5", "6"]);
  });

  it("extractSummarySections: goal из первого user, решения/вопросы по маркерам", () => {
    const middle = [
      m("user", "Хочу отчёт по расходам"),
      m("assistant", "Decision: собрать за март\nГотово: CSV выгружен"),
      m("user", "А за апрель?"),
    ];
    const s = extractSummarySections(middle);
    assert.equal(s.goal, "Хочу отчёт по расходам");
    assert.deepEqual(s.decisions, ["собрать за март"]);
    assert.deepEqual(s.openQuestions, ["А за апрель?"]);
  });

  it("summarizeMiddle: head|middle|tail без пересечений", () => {
    const input = [
      m("system", "sys"),
      m("user", "u1"),
      m("assistant", "a1"),
      m("user", "u2"),
      m("assistant", "a2"),
      m("user", "u3"),
      m("assistant", "a3"),
    ];
    const { head, middle, tail, summary } = summarizeMiddle(input, { recentTurns: 1 });
    assert.equal(head.length, 1);
    assert.deepEqual(tail.map((x) => x.content), ["u3", "a3"]);
    assert.deepEqual(middle.map((x) => x.content), ["u1", "a1", "u2", "a2"]);
    assert.equal(summary.goal, "u1");
  });

  it("renderSummary: структурированный markdown", () => {
    const rendered = renderSummary({
      goal: "G",
      progress: "P",
      decisions: ["d1", "d2"],
      openQuestions: ["q1"],
    });
    assert.match(rendered, /^## Goal\nG/);
    assert.match(rendered, /## Progress\nP/);
    assert.match(rendered, /- d1\n- d2/);
    assert.match(rendered, /## Open Questions\n- q1/);
  });

  it("mergeSummaries: новый goal/progress выигрывает, решения/вопросы дедуп", () => {
    const prev = { decisions: ["a", "b"], openQuestions: ["q1"], goal: "old", progress: "oldP" };
    const curr = { decisions: ["b", "c"], openQuestions: ["q2"], goal: "new" };
    const merged = mergeSummaries(prev, curr);
    assert.equal(merged.goal, "new");
    assert.equal(merged.progress, "oldP");
    assert.deepEqual(merged.decisions, ["a", "b", "c"]);
    assert.deepEqual(merged.openQuestions, ["q1", "q2"]);
  });

  it("persist/restore: roundtrip", () => {
    const sections = { decisions: ["d"], openQuestions: [], goal: "g", progress: "p" };
    const restored = restoreSummary(persistSummary(sections));
    assert.deepEqual(restored, sections);
  });

  it("restoreSummary: мусор/неверная версия → пустые секции (без throw)", () => {
    assert.deepEqual(restoreSummary("not json"), emptySummary());
    assert.deepEqual(restoreSummary(JSON.stringify({ version: 99, sections: { decisions: ["x"] } })), emptySummary());
  });
});
