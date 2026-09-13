/**
 * Item 4.3 (D2, §9): reciprocal rank fusion для сессионного поиска.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankedById,
  rrfMerge,
  rrfScore,
} from "../../src/runtime/session/rrf.js";

describe("RRF (Item 4.3)", () => {
  it("rrfScore: 1/(k+rank), ранг не уходит в минус", () => {
    assert.equal(rrfScore(0, 60), 1 / 60);
    assert.equal(rrfScore(1, 60), 1 / 61);
    assert.equal(rrfScore(-5, 60), 1 / 60);
  });

  it("rankedById даёт 0-based ранги", () => {
    assert.deepEqual(rankedById(["x", "y"]), [
      { id: "x", rank: 0 },
      { id: "y", rank: 1 },
    ]);
  });

  it("rrfMerge: элемент в обоих списках выше, чем в одном", () => {
    const fts = rankedById(["a", "b", "c"]);
    const vec = rankedById(["c", "a"]);
    const merged = rrfMerge([fts, vec]);
    const byId = new Map(merged.map((m) => [m.id, m.score]));
    assert.ok((byId.get("a") ?? 0) > (byId.get("b") ?? 0));
    assert.ok((byId.get("c") ?? 0) > (byId.get("b") ?? 0));
  });

  it("rrfMerge: сортировка по убыванию скора", () => {
    const merged = rrfMerge([rankedById(["a", "b", "c", "d"])]);
    assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c", "d"]);
  });

  it("rrfMerge: пустые списки → пустой результат", () => {
    assert.deepEqual(rrfMerge([]), []);
    assert.deepEqual(rrfMerge([[]]), []);
  });

  it("меньший k усиливает верхние позиции", () => {
    const merged60 = rrfMerge([rankedById(["a", "b"])], 60);
    const merged2 = rrfMerge([rankedById(["a", "b"])], 2);
    assert.ok(merged2[0].score > merged60[0].score);
  });

  it("детерминированная сортировка при равных скорах", () => {
    const merged = rrfMerge([rankedById(["a", "b"]), rankedById(["b", "a"])]);
    assert.equal(merged[0].score, merged[1].score);
    assert.deepEqual(merged.map((m) => m.id), ["a", "b"]);
  });
});
