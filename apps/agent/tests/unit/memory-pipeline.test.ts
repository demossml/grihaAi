/**
 * Item 5.2 (E5): пайплайн candidate→confidence→conflict→persist.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decidePersist,
  detectConflict,
  evaluateCandidate,
  normalizeText,
  similarity,
} from "../../src/runtime/memory/pipeline.js";
import type { MemoryInput, MemoryRecord } from "../../src/runtime/memory/types.js";

const input = (over: Partial<MemoryInput> = {}): MemoryInput => ({
  type: "fact",
  content: "Клиент предпочитает email",
  source: "chat",
  confidence: 0.9,
  ...over,
});

const record = (id: string, content: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id,
  type: "fact",
  content,
  source: "chat",
  confidence: 0.8,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  evidence: [],
  status: "confirmed",
  provenance: "chat",
  ...over,
});

describe("Memory pipeline (Item 5.2)", () => {
  it("normalizeText схлопывает регистр/пробелы", () => {
    assert.equal(normalizeText("  Клиент   ПРЕДПОЧИТАЕТ email "), "клиент предпочитает email");
  });

  it("similarity: одинаковые → 1, разные → < 1", () => {
    assert.equal(similarity("abc", "abc"), 1);
    assert.ok(similarity("клиент предпочитает email", "клиент любит email") < 1);
    assert.ok(similarity("совсем разный текст", "другая тема") < 0.5);
  });

  it("evaluateCandidate: confidence-пороги", () => {
    assert.equal(evaluateCandidate(input({ confidence: 0.9 })).status, "confirmed");
    assert.equal(evaluateCandidate(input({ confidence: 0.5 })).status, "candidate");
    assert.equal(evaluateCandidate(input({ confidence: 0.2 })).accepted, false);
  });

  it("detectConflict: near-duplicate", () => {
    const existing = [record("m1", "Клиент предпочитает email")];
    const conflict = detectConflict(input({ content: "клиент предпочитает email" }), existing);
    assert.equal(conflict.kind, "duplicate");
    assert.equal(conflict.against?.id, "m1");
  });

  it("detectConflict: противоречие по отрицанию", () => {
    const existing = [record("m1", "Клиент предпочитает email")];
    const conflict = detectConflict(
      input({ content: "Клиент НЕ предпочитает email" }),
      existing,
    );
    assert.equal(conflict.kind, "contradiction");
  });

  it("detectConflict: другой тип памяти не конфликтует", () => {
    const existing = [record("m1", "Клиент предпочитает email", { type: "preference" })];
    const conflict = detectConflict(input({ content: "Клиент предпочитает email" }), existing);
    assert.equal(conflict.kind, "none");
  });

  it("decidePersist: reject → reinforce → contradict → persist", () => {
    assert.equal(decidePersist(input({ confidence: 0.1 }), []).action, "reject");
    const dup = decidePersist(input({ content: "клиент предпочитает email" }), [
      record("m1", "Клиент предпочитает email"),
    ]);
    assert.equal(dup.action, "reinforce");
    const contra = decidePersist(input({ content: "клиент не предпочитает email" }), [
      record("m1", "Клиент предпочитает email"),
    ]);
    assert.equal(contra.action, "contradict");
    assert.equal(decidePersist(input(), []).action, "persist");
  });
});
