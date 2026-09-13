import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextBuilder, type ContextReaders } from "../../src/context/ContextBuilder.js";

/**
 * C2 (матрица C2/C4, §8) — структурная компакция середины в ContextBuilder.
 * Flag on + превышение бюджета → head (system) + rendered summary
 * (Goal/Progress/Decisions/Open Questions) + tail (recent) + маркер;
 * итеративная ре-компрессия через InMemorySessionSummaryStore.
 * Flag off = 1:1 без изменений.
 */

function makeReaders(options?: { notes?: string; commitments?: number }): ContextReaders {
  const count = options?.commitments ?? 12;
  return {
    getEvents: () => [],
    getCommitments: () =>
      Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        userId: "u1",
        text: `decision: шаг ${i} для Ивана\nвопрос про дедлайн?`,
        status: "open" as const,
        confidence: 0.9,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      })),
    getAnomalies: () => [],
    getApprovals: () => [],
    getClientNotes: async () => [
      {
        id: "n1",
        userId: "u1",
        category: "other",
        content:
          options?.notes ??
          "decision: отправить отчёт\nНужно ли звонить клиенту?\n" + "x".repeat(2500),
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    getContacts: () => [
      {
        id: "contact-1",
        userId: "u1",
        name: "Иван",
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    getExpenses: () => [],
    getInvoices: () => [],
  };
}

describe("ContextBuilder compaction (C2)", () => {
  it("flag off: без изменений (паритет)", async () => {
    const builder = new ContextBuilder(makeReaders(), {});
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(!result.text.includes("ужат"));
    assert.ok(!result.text.includes("## Goal"));
  });

  it("flag on + превышение: head сохранён, summary секции, tail, маркер", async () => {
    const builder = new ContextBuilder(
      makeReaders({
        notes:
          "decision: отправить отчёт\nНужно ли звонить клиенту?\n" + "y".repeat(3000),
      }),
      { HERMES_AGENT_RUNTIME: "1" },
      1000,
      "session-1",
    );
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(result.items[0].includes("Контекст по контакту"), "head сохранён");
    assert.ok(result.text.includes("## Goal"), "summary Goal");
    assert.ok(result.text.includes("## Decisions"), "summary Decisions");
    assert.ok(result.text.includes("ужат"), "маркер компакции");
    assert.ok(result.text.includes("резюме"), "маркер резюме");
  });

  it("итеративная ре-компрессия: решения из обоих прогонов сохраняются", async () => {
    const builder = new ContextBuilder(
      makeReaders(),
      { HERMES_AGENT_RUNTIME: "1" },
      1000,
      "session-iter",
    );
    const first = await builder.getContactContext("u1", "Иван");
    const second = await builder.getContactContext("u1", "Иван");
    assert.ok(first.text.includes("## Decisions"));
    assert.ok(first.text.includes("ужат"));
    // Детерминированность: одинаковый ввод → идентичный вывод
    // (решения не удваиваются при итеративной ре-компрессии).
    assert.equal(first.text, second.text);
  });

  it("middle пуст (мало items) → fallback W3-ужатие", async () => {
    const builder = new ContextBuilder(
      makeReaders({ commitments: 2 }),
      { HERMES_AGENT_RUNTIME: "1" },
      1000,
    );
    const result = await builder.getContactContext("u1", "Иван");
    assert.ok(result.text.includes("ужат"));
    assert.ok(!result.text.includes("## Goal"));
  });
});
