/**
 * Item 7.2 (G3/G4): experience store + contradiction/deprecate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExperienceStore } from "../../src/runtime/learning/experience.js";

let seq = 0;
const makeStore = () =>
  new ExperienceStore({
    idFactory: () => `e${++seq}`,
    now: () => "2026-01-01T00:00:00Z",
  });

describe("Experience store (Item 7.2)", () => {
  it("add: полный record (task/tools/errors/result/eval/lesson)", () => {
    const store = makeStore();
    const record = store.add(
      {
        task: "Собрать отчёт",
        tools: ["sqlite-query"],
        errors: [],
        result: "CSV готов",
        lesson: "сначала спросить период",
      },
      0.9,
    );
    assert.equal(record.evaluation?.score, 0.9);
    assert.equal(record.deprecated, false);
    assert.ok(record.id.startsWith("e"));
  });

  it("list: фильтры task и deprecated", () => {
    const store = makeStore();
    store.add({ task: "Собрать отчёт" });
    store.add({ task: "Отправить письмо" });
    assert.equal(store.list().length, 2);
    assert.equal(store.list({ task: "отчёт" }).length, 1);
    assert.equal(store.list({ deprecated: false }).length, 2);
    assert.equal(store.list({ deprecated: true }).length, 0);
  });

  it("contradictionCheck: похожий task + другой result → deprecate старого (G4)", () => {
    const store = makeStore();
    const old = store.add({ task: "Собрать отчёт за март", result: "CSV" });
    const result = store.contradictionCheck({ task: "Собрать отчёт за март", result: "PDF" });
    assert.equal(result.contradicted?.id, old.id);
    assert.equal(store.get(old.id)?.deprecated, true);
  });

  it("contradictionCheck: тот же result не deprecate; далёкий task игнорируется", () => {
    const store = makeStore();
    const old = store.add({ task: "Собрать отчёт за март", result: "CSV" });
    const same = store.contradictionCheck({ task: "Собрать отчёт за март", result: "csv" });
    assert.equal(same.contradicted, null);
    assert.equal(store.get(old.id)?.deprecated, false);
    const far = store.contradictionCheck({ task: "Совсем другая задача", result: "X" });
    assert.equal(far.contradicted, null);
  });

  it("contradictionCheck: deprecated записи не участвуют", () => {
    const store = makeStore();
    const old = store.add({ task: "Задача", result: "A" });
    store.contradictionCheck({ task: "Задача", result: "B" });
    assert.equal(store.get(old.id)?.deprecated, true);
    const again = store.contradictionCheck({ task: "Задача", result: "C" });
    assert.equal(again.contradicted, null);
  });
});
