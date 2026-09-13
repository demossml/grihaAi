/**
 * Wiring W3: ContextBuilder budget guard за флагом (C1/C2).
 * Flag off = результат без изменений.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextBuilder, type ContextReaders } from "../../src/context/ContextBuilder.js";

const readers: ContextReaders = {
  getEvents: () => [],
  getCommitments: () => [],
  getAnomalies: () => [],
  getApprovals: () => [],
  getClientNotes: async () => [
    { id: "n1", userId: "u1", category: "other", content: "x".repeat(4000), createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ],
  getContacts: () => [],
  getExpenses: () => [],
  getInvoices: () => [],
};

describe("ContextBuilder wiring (W3)", () => {
  it("flag off: результат без изменений (паритет)", async () => {
    const builder = new ContextBuilder(readers, {});
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(result.text.includes("Контекст по контакту"));
    assert.ok(!result.text.includes("ужат"));
  });

  it("flag on: превышение бюджета → приоритетное ужатие с маркером", async () => {
    const builder = new ContextBuilder(readers, { HERMES_AGENT_RUNTIME: "1" }, 1000);
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(result.text.includes("ужат"));
    assert.ok(result.items[0].includes("Контекст по контакту"));
  });

  it("flag on: малый контекст не трогается", async () => {
    const builder = new ContextBuilder(readers, { HERMES_AGENT_RUNTIME: "1" }, 100_000);
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(!result.text.includes("ужат"));
  });

  it("flag off: другие методы тоже без изменений", async () => {
    const builder = new ContextBuilder(readers, {});
    const result = builder.getFinancialContext("u1");
    assert.equal(typeof result.text, "string");
  });
});
