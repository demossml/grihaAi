/**
 * Item 6.2 (F2): построчный LCS-diff.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDiff,
  diffChangeCount,
  diffLines,
  splitLines,
} from "../../src/runtime/skill/diff.js";

describe("Skill diff (Item 6.2)", () => {
  it("идентичные тексты → все same, changeCount 0", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc");
    assert.ok(ops.every((o) => o.kind === "same"));
    assert.equal(diffChangeCount(ops), 0);
  });

  it("замена строки → remove + add", () => {
    const ops = diffLines("a\nold\nc", "a\nnew\nc");
    const kinds = ops.map((o) => `${o.kind}:${o.line}`);
    assert.deepEqual(kinds, ["same:a", "remove:old", "add:new", "same:c"]);
  });

  it("добавление строки в конец → add", () => {
    const ops = diffLines("a\nb", "a\nb\nc");
    assert.deepEqual(ops.map((o) => `${o.kind}:${o.line}`), ["same:a", "same:b", "add:c"]);
  });

  it("удаление строки → remove", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    assert.deepEqual(ops.map((o) => `${o.kind}:${o.line}`), ["same:a", "remove:b", "same:c"]);
  });

  it("applyDiff восстанавливает новый текст", () => {
    const ops = diffLines("a\nold\nc", "a\nnew\nc");
    assert.equal(applyDiff(ops), "a\nnew\nc");
  });

  it("splitLines отбрасывает финальный пустой элемент", () => {
    assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  });

  it("пустой → полный новый текст: все add", () => {
    const ops = diffLines("", "x\ny");
    assert.deepEqual(ops.map((o) => `${o.kind}:${o.line}`), ["add:x", "add:y"]);
    assert.equal(diffChangeCount(ops), 2);
  });
});
