/**
 * Item 7.3 (E8/§11): локальная user model.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UserModelStore } from "../../src/runtime/learning/user-model.js";

describe("User model (Item 7.3)", () => {
  it("observe: новый инсайт — candidate, повтор — confidence растёт до confirmed", () => {
    const store = new UserModelStore({ idFactory: () => "u1" });
    const first = store.observe("preference", "Любит чай", "chat", 0.4);
    assert.equal(first?.status, "candidate");
    assert.equal(first?.evidenceCount, 1);
    const second = store.observe("preference", "Любит чай", "chat", 0.4);
    assert.equal(second?.status, "confirmed");
    assert.equal(second?.evidenceCount, 2);
    assert.ok((second?.confidence ?? 0) > 0.7);
  });

  it("слабый сигнал (ниже candidateThreshold) не запоминается (§11)", () => {
    const store = new UserModelStore({ idFactory: () => "u1" });
    assert.equal(store.observe("habit", "иногда пьёт воду", "chat", 0.1), null);
    assert.equal(store.list().length, 0);
  });

  it("contradict: депрекейтит инсайт категории", () => {
    const store = new UserModelStore({ idFactory: () => "u1" });
    store.observe("preference", "Любит чай", "chat", 0.9);
    const deprecated = store.contradict("preference", "Не любит чай");
    assert.equal(deprecated?.status, "deprecated");
    assert.equal(store.list("preference")[0].status, "deprecated");
  });

  it("list: фильтр по категории", () => {
    const store = new UserModelStore({ idFactory: () => "u1" });
    store.observe("preference", "Любит чай", "chat", 0.8);
    store.observe("habit", "Работает утром", "chat", 0.8);
    assert.equal(store.list().length, 2);
    assert.equal(store.list("habit").length, 1);
  });

  it("evidence от повторного наблюдения после confirm не перезаписывает статус", () => {
    const store = new UserModelStore({ idFactory: () => "u1" });
    store.observe("goal", "Цель: отпуск", "chat", 0.8);
    store.observe("goal", "Цель: отпуск", "chat", 0.1);
    const all = store.list("goal");
    assert.equal(all[0].status, "confirmed");
    assert.equal(all[0].evidenceCount, 2);
  });
});
