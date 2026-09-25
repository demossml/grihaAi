/**
 * L3 — review lessons → routeLesson → applyLessonRoute handlers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SkillCandidateStore,
  applyLessonRoute,
  routeBackgroundLessons,
  type LessonRouteCtx,
} from "../../src/runtime/learning/apply-lesson-route.js";
import type { MemoryEngine } from "../../src/runtime/memory/types.js";
import { UserModelStore } from "../../src/runtime/learning/user-model.js";

function makeMemory(spy?: (input: unknown) => void): MemoryEngine {
  return {
    remember: async (input) => {
      spy?.(input);
      return { id: "m1", ...input } as never;
    },
    recall: async () => [],
    forget: async () => {},
    reinforce: async () => {},
    contradict: async () => {},
  } as MemoryEngine;
}

function makeCtx(overrides: Partial<LessonRouteCtx> = {}): LessonRouteCtx {
  return {
    memory: makeMemory(),
    userModel: new UserModelStore({ idFactory: () => "u1" }),
    skillCandidates: new SkillCandidateStore(() => "2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("applyLessonRoute (L3)", () => {
  it("factual → memory handler called", async () => {
    const seen: unknown[] = [];
    const ctx = makeCtx({ memory: makeMemory((input) => seen.push(input)) });
    const result = await applyLessonRoute(
      { target: "memory" },
      { content: "адрес офиса — Тверская 1" },
      ctx,
    );
    assert.equal(result, "ok");
    assert.equal(seen.length, 1);
    assert.equal((seen[0] as { type: string }).type, "lesson");
  });

  it("preference → user-model handler (candidate, not force)", async () => {
    const ctx = makeCtx();
    const result = await applyLessonRoute(
      { target: "user-model" },
      { content: "предпочитает email вместо звонков" },
      ctx,
    );
    assert.equal(result, "ok");
    const insights = ctx.userModel.list("preference");
    assert.equal(insights.length, 1);
  });

  it("procedural → skill candidate handler (evidence, НЕ activate/proposal)", async () => {
    const ctx = makeCtx();
    const result = await applyLessonRoute(
      { target: "skill" },
      { content: "сначала собрать период, потом строить отчёт" },
      ctx,
    );
    assert.equal(result, "ok");
    assert.equal(ctx.skillCandidates.count(), 1);
    // Не proposal-файл: нет applySkillProposal / SKILL.md записи — только evidence.
  });

  it("unknown/drop → drop", async () => {
    const ctx = makeCtx();
    const result = await applyLessonRoute({ target: "drop" }, { content: "..." }, ctx);
    assert.equal(result, "drop");
    assert.equal(ctx.skillCandidates.count(), 0);
  });

  it("memory handler throws → error, no throw out", async () => {
    const throwing: MemoryEngine = {
      remember: async () => {
        throw new Error("db down");
      },
      recall: async () => [],
      forget: async () => {},
      reinforce: async () => {},
      contradict: async () => {},
    };
    const ctx = makeCtx({ memory: throwing });
    const result = await applyLessonRoute({ target: "memory" }, { content: "x" }, ctx);
    assert.equal(result, "error");
  });
});

describe("routeBackgroundLessons (L3)", () => {
  it("маршрутизирует уроки в handlers по содержимому", async () => {
    const outcome = await routeBackgroundLessons([
      { content: "адрес клиента — Невский 5" }, // factual → memory
      { content: "пользователь предпочитает короткие ответы" }, // preference → user-model
      { content: "процедура: сначала экспорт, потом отчёт" }, // procedural → skill
      { content: "бла-бла без маркеров" }, // unknown → drop
    ]);
    assert.equal(outcome.routed, 3);
    assert.equal(outcome.dropped, 1);
    assert.equal(outcome.errors, 0);
  });

  it("пустой/битый список уроков → no throw, ноль handlers", async () => {
    const empty = await routeBackgroundLessons([]);
    assert.deepEqual(empty, { routed: 0, dropped: 0, errors: 0 });

    const broken = await routeBackgroundLessons([{ content: "  " }, { content: "" }]);
    assert.deepEqual(broken, { routed: 0, dropped: 0, errors: 0 });
  });

  it("невалидный JSON review → parse даёт пусто, routing не падает", async () => {
    // «invalid LLM JSON» уже отфильтрован parseReviewLessons; здесь проверяем,
    // что routeBackgroundLessons на пустом результате ничего не роняет.
    const outcome = await routeBackgroundLessons([]);
    assert.equal(outcome.routed, 0);
  });
});
