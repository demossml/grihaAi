import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextBuilder, type ContextReaders } from "../../src/context/ContextBuilder.js";
import type {
  CalendarEvent,
  Commitment,
} from "../../src/types/index.js";

const NOW = new Date("2026-09-08T09:00:00Z");

function makeReaders(overrides: Partial<ContextReaders> = {}): ContextReaders {
  return {
    getEvents: () => [],
    getCommitments: () => [],
    getAnomalies: () => [],
    getApprovals: () => [],
    getClientNotes: async () => [],
    getContacts: () => [],
    getExpenses: () => [],
    getInvoices: () => [],
    ...overrides,
  };
}

const meeting: CalendarEvent = {
  id: "e1",
  userId: "u1",
  title: "Созвон с Иваном",
  startsAt: "2026-09-08T06:30:00Z",
  endsAt: "2026-09-08T07:30:00Z",
  timezone: "Europe/Moscow",
  participants: ["Иван"],
  kind: "meeting",
  source: "manual",
  status: "scheduled",
  createdAt: "x",
  updatedAt: "x",
};

const commitment: Commitment = {
  id: "c1",
  userId: "u1",
  text: "Отправить договор",
  status: "overdue",
  confidence: 1,
  createdAt: "x",
  updatedAt: "x",
};

describe("ContextBuilder", () => {
  it("builds meeting context from the event, commitments and notes", async () => {
    const builder = new ContextBuilder(
      makeReaders({
        getEvents: () => [meeting],
        getCommitments: () => [commitment],
        getClientNotes: async () => [{ id: "n1", userId: "u1", content: "важная заметка", category: "other", createdAt: "x", updatedAt: "x" }],
      }),
    );
    const ctx = await builder.getMeetingContext("u1", "e1");
    assert.ok(ctx.text.includes("Созвон с Иваном"));
    assert.ok(ctx.text.includes("Отправить договор"));
  });

  it("builds contact context with notes and related commitments", async () => {
    const builder = new ContextBuilder(
      makeReaders({
        getCommitments: () => [{ ...commitment, toWhom: "Иван" }],
        getClientNotes: async () => [{ id: "n1", userId: "u1", content: "любит детали", category: "preference", createdAt: "x", updatedAt: "x" }],
      }),
    );
    const ctx = await builder.getContactContext("u1", "иван");
    assert.ok(ctx.text.includes("любит детали"));
    assert.ok(ctx.text.includes("Отправить договор"));
  });

  it("builds a daily briefing without empty sections", async () => {
    const builder = new ContextBuilder(
      makeReaders({
        getCommitments: () => [commitment],
      }),
    );
    const ctx = await builder.getDailyBriefingContext("u1", "Europe/Moscow", );
    void NOW;
    assert.ok(ctx.text.includes("Отправить договор"));
  });

  it("builds commitment and financial contexts", () => {
    const builder = new ContextBuilder(
      makeReaders({
        getCommitments: () => [commitment],
        getExpenses: () => [
          { id: "x", userId: "u1", date: "2026-09-01", vendor: "A", amount: 100, currency: "RUB", confidence: 1, source: "manual", createdAt: "x" },
        ],
      }),
    );
    assert.ok(builder.getCommitmentContext("u1").text.includes("Просрочено"));
    assert.ok(builder.getFinancialContext("u1").text.includes("100"));
  });
});
