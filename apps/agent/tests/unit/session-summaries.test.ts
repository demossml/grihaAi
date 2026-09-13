/**
 * Item 4.2 (D3): in-memory session summaries store.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemorySessionSummaryStore,
  renderSessionSummary,
} from "../../src/runtime/session/summaries.js";

describe("Session summaries (Item 4.2)", () => {
  it("upsert/get: первая запись", () => {
    const store = new InMemorySessionSummaryStore();
    const entry = store.upsert("s1", { decisions: ["d1"], openQuestions: [] }, "2026-01-01");
    assert.equal(entry.sessionId, "s1");
    assert.equal(store.get("s1")?.sections.decisions[0], "d1");
    assert.equal(store.get("nope"), undefined);
  });

  it("upsert мержит с прошлым summary (итеративная ре-компрессия)", () => {
    const store = new InMemorySessionSummaryStore();
    store.upsert("s1", { decisions: ["a"], openQuestions: ["q1"], goal: "old" }, "2026-01-01");
    const merged = store.upsert(
      "s1",
      { decisions: ["b"], openQuestions: ["q2"], goal: "new" },
      "2026-01-02",
    );
    assert.equal(merged.sections.goal, "new");
    assert.deepEqual(merged.sections.decisions, ["a", "b"]);
    assert.deepEqual(merged.sections.openQuestions, ["q1", "q2"]);
    assert.equal(store.size(), 1);
  });

  it("list: сортировка по updatedAt DESC", () => {
    const store = new InMemorySessionSummaryStore();
    store.upsert("a", { decisions: [], openQuestions: [] }, "2026-01-01");
    store.upsert("b", { decisions: [], openQuestions: [] }, "2026-01-03");
    store.upsert("c", { decisions: [], openQuestions: [] }, "2026-01-02");
    assert.deepEqual(store.list().map((e) => e.sessionId), ["b", "c", "a"]);
  });

  it("delete возвращает факт удаления", () => {
    const store = new InMemorySessionSummaryStore();
    store.upsert("s1", { decisions: [], openQuestions: [] });
    assert.equal(store.delete("s1"), true);
    assert.equal(store.delete("s1"), false);
  });

  it("renderSessionSummary: markdown из C4-шаблона", () => {
    const store = new InMemorySessionSummaryStore();
    const entry = store.upsert("s1", { goal: "G", decisions: [], openQuestions: [] });
    const rendered = renderSessionSummary(entry);
    assert.match(rendered, /^## Goal\nG/);
  });
});
