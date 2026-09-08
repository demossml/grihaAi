import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyComplexity } from "../../../src/utils/routing/adaptive-router.js";

describe("delegation triage", () => {
  it("does not delegate short reminders", async () => {
    const { complexity } = await classifyComplexity("напомни в 15:00 позвонить");
    assert.equal(complexity, "simple");
  });

  it("does not delegate simple lookups", async () => {
    const { complexity } = await classifyComplexity("найди все заметки по клиенту Иван");
    assert.equal(complexity, "simple");
  });

  it("delegates multi-part research tasks", async () => {
    const { complexity } = await classifyComplexity(
      "сравни предложения трёх поставщиков и подготовь отчёт по итогам квартала",
    );
    assert.equal(complexity, "complex");
  });

  it("treats very long messages as complex", async () => {
    const long = "а".repeat(300);
    const { complexity } = await classifyComplexity(long);
    assert.equal(complexity, "complex");
  });
});
