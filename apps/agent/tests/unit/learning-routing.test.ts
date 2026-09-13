/**
 * Item 7.1 (G2): классификация и маршрутизация уроков.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyLesson, routeLesson } from "../../src/runtime/learning/routing.js";

describe("Lesson routing (Item 7.1)", () => {
  it("preference → user-model", () => {
    const route = routeLesson({ content: "Клиент предпочитает email", source: "chat" });
    assert.equal(route.kind, "preference");
    assert.equal(route.target, "user-model");
  });

  it("procedural → skill", () => {
    const route = routeLesson({
      content: "Каждый раз сначала проверяй курс валют, потом считай",
      source: "chat",
    });
    assert.equal(route.kind, "procedural");
    assert.equal(route.target, "skill");
  });

  it("factual → memory", () => {
    const route = routeLesson({ content: "Почта клиента: a@b.ru", source: "chat" });
    assert.equal(route.kind, "factual");
    assert.equal(route.target, "memory");
  });

  it("неклассифицируемое → drop", () => {
    const route = routeLesson({ content: "ок", source: "chat" });
    assert.equal(route.kind, "unknown");
    assert.equal(route.target, "drop");
  });

  it("classifyLesson: приоритет preference над procedural", () => {
    const kind = classifyLesson({ content: "Я всегда предпочитаю длинные отчёты", source: "chat" });
    assert.equal(kind, "preference");
  });
});
