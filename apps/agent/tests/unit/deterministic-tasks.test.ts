import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runDeterministicTask,
  DETERMINISTIC_TASK_NAMES,
  type DeterministicTaskDeps,
} from "../../src/cron/deterministic-tasks.js";
import type { Commitment } from "../../src/types/index.js";

const NOW = new Date("2026-09-08T09:00:00Z");

function makeDeps(overrides: Partial<DeterministicTaskDeps> = {}): DeterministicTaskDeps {
  return {
    userId: "u1",
    timezone: "Europe/Moscow",
    now: NOW,
    listCommitments: () => [],
    listAnomalies: () => [],
    listApprovals: () => [],
    listEvents: () => [],
    listClientNotes: async () => [],
    listExpenses: () => [],
    listInvoices: () => [],
    ...overrides,
  };
}

const overdue: Commitment = {
  id: "c1",
  userId: "u1",
  text: "Отправить отчёт",
  status: "overdue",
  dueDate: "2026-09-01T00:00:00Z",
  confidence: 1,
  createdAt: "x",
  updatedAt: "x",
};

describe("deterministic cron tasks", () => {
  it("lists all task names", () => {
    assert.deepEqual(DETERMINISTIC_TASK_NAMES, ["daily-briefing", "anomaly-scan", "commitment-due-scan"]);
  });

  it("daily-briefing aggregates deterministically (no LLM)", async () => {
    const res = await runDeterministicTask("daily-briefing", makeDeps({
      listCommitments: () => [overdue],
    }));
    assert.ok(res.summary.includes("Отправить отчёт"));
  });

  it("commitment-due-scan surfaces overdue without an LLM", async () => {
    const res = await runDeterministicTask("commitment-due-scan", makeDeps({
      listCommitments: () => [overdue],
    }));
    assert.ok(res.summary.includes("Просрочено"));
    assert.ok(res.summary.includes("Отправить отчёт"));
  });

  it("anomaly-scan runs deterministic detectors", async () => {
    const res = await runDeterministicTask("anomaly-scan", makeDeps({
      listCommitments: () => [overdue],
      listInvoices: () => [
        { id: "i1", userId: "u1", number: "INV-1", vendor: "X", amount: 100, currency: "RUB", status: "overdue", createdAt: "x", updatedAt: "x" },
      ],
    }));
    assert.ok(res.summary.includes("просрочен") || res.summary.includes("Отправить отчёт"));
  });

  it("anomaly-scan reports nothing when clean", async () => {
    const res = await runDeterministicTask("anomaly-scan", makeDeps());
    assert.equal(res.summary, "Аномалий нет.");
  });
});
