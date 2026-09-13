/**
 * Item 6.3 (F3): версионирование — LLM не перезаписывает prod,
 * хуже версия не активируется, rollback работает.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillVersionStore } from "../../src/runtime/skill/versioning.js";

const makeStore = () =>
  new SkillVersionStore({
    name: "calendar",
    initialContent: "Инструкция v1\nшаг A",
    now: () => "2026-01-01T00:00:00Z",
  });

describe("Skill versioning (Item 6.3)", () => {
  it("корневая версия 1 активна, поля §14 на месте", () => {
    const store = makeStore();
    const v = store.activeVersion()!;
    assert.equal(v.version, 1);
    assert.equal(v.parentVersion, null);
    assert.equal(v.active, true);
    assert.equal(v.author, "system");
    assert.deepEqual(v.diff, []);
    assert.equal(v.rollbackVersion, null);
  });

  it("propose: новая версия неактивна, prod-контент не меняется", () => {
    const store = makeStore();
    const proposed = store.propose("Инструкция v2\nшаг A\nшаг B", "llm");
    assert.equal(proposed.version, 2);
    assert.equal(proposed.parentVersion, 1);
    assert.equal(proposed.active, false);
    assert.equal(store.activeVersion()?.version, 1);
    assert.equal(store.content(), "Инструкция v1\nшаг A");
    assert.ok(proposed.diff.length > 0);
  });

  it("validation: пустой контент и no-op → ошибка", () => {
    const store = makeStore();
    assert.throws(() => store.propose("   ", "llm"), /must not be empty/);
    assert.throws(() => store.propose("Инструкция v1\nшаг A", "llm"), /no changes/);
  });

  it("хуже версия: старая остаётся активной (§14)", () => {
    const store = makeStore();
    store.evaluate(1, 0.9, 0.6);
    const better = store.propose("Инструкция v2\nшаг A\nшаг B", "llm");
    store.evaluate(better.version, 0.95, 0.6);
    assert.equal(store.approveAndActivate(better.version).activated, true);
    // теперь предлагаем худшую
    const worse = store.propose("Инструкция v3\nшаг A", "llm");
    store.evaluate(worse.version, 0.7, 0.6);
    const result = store.approveAndActivate(worse.version);
    assert.equal(result.activated, false);
    assert.match(result.reason, /старая версия остаётся активной/);
    assert.equal(store.activeVersion()?.version, better.version);
    assert.equal(store.content(), "Инструкция v2\nшаг A\nшаг B");
  });

  it("не оценённая / не прошедшая порог версия не активируется", () => {
    const store = makeStore();
    const proposed = store.propose("Инструкция v2\nшаг B", "llm");
    assert.equal(store.approveAndActivate(proposed.version).reason, "not evaluated yet");
    store.evaluate(proposed.version, 0.4, 0.6);
    assert.equal(store.approveAndActivate(proposed.version).reason, "evaluation not passed");
  });

  it("rollback возвращает предыдущую активную версию", () => {
    const store = makeStore();
    const v2 = store.propose("Инструкция v2\nшаг A\nшаг B", "llm");
    store.evaluate(v2.version, 0.95, 0.6);
    store.approveAndActivate(v2.version);
    assert.equal(store.content(), "Инструкция v2\nшаг A\nшаг B");
    const rolled = store.rollback();
    assert.equal(rolled.rolledBack, true);
    assert.equal(store.activeVersion()?.version, 1);
    assert.equal(store.content(), "Инструкция v1\nшаг A");
  });

  it("rollback без предыдущей версии → false", () => {
    const store = makeStore();
    assert.equal(store.rollback().rolledBack, false);
  });

  it("content() восстанавливается через цепочку диффов (v1→v2→v3)", () => {
    const store = makeStore();
    const v2 = store.propose("Инструкция v2\nшаг A\nшаг B", "llm");
    store.evaluate(v2.version, 0.8, 0.6);
    store.approveAndActivate(v2.version);
    const v3 = store.propose("Инструкция v3\nшаг A\nшаг B\nшаг C", "llm");
    store.evaluate(v3.version, 0.9, 0.6);
    store.approveAndActivate(v3.version);
    assert.equal(store.content(), "Инструкция v3\nшаг A\nшаг B\nшаг C");
    assert.equal(store.get(v3.version)?.rollbackVersion, v2.version);
  });
});
