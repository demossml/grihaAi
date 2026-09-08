import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CommitmentService,
  deriveStatus,
  DUE_SOON_WINDOW_MS,
} from "../../.pi/extensions/commitment-tracking/CommitmentService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "commitment-service-test.sqlite";

function freshService(): CommitmentService {
  cleanTestDb(DB_NAME);
  const svc = new CommitmentService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("commitment status derivation", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("keeps terminal statuses", () => {
    assert.equal(deriveStatus("completed", "2026-01-01", now), "completed");
    assert.equal(deriveStatus("cancelled", undefined, now), "cancelled");
  });

  it("derives overdue / due_soon / open from the due date", () => {
    assert.equal(deriveStatus("open", "2026-09-07T00:00:00Z", now), "overdue");
    assert.equal(
      deriveStatus("open", new Date(now.getTime() + DUE_SOON_WINDOW_MS / 2).toISOString(), now),
      "due_soon",
    );
    assert.equal(
      deriveStatus("open", new Date(now.getTime() + DUE_SOON_WINDOW_MS * 3).toISOString(), now),
      "open",
    );
  });

  it("returns open when no due date", () => {
    assert.equal(deriveStatus("open", undefined, now), "open");
  });
});

describe("commitment service", () => {
  it("adds and lists commitments scoped to user", () => {
    const svc = freshService();
    const c = svc.add({ userId: "u1", text: "Отправить договор" });
    assert.equal(c.status, "open");
    assert.equal(c.confidence, 1);

    assert.equal(svc.list("u1").length, 1);
    assert.equal(svc.list("u2").length, 0);
  });

  it("stores source and provenance links", () => {
    const svc = freshService();
    const c = svc.add({
      userId: "u1",
      text: "Подготовить смету",
      who: "Гриша",
      toWhom: "Иван",
      sourceType: "meeting",
      sourceId: "m1",
      meetingId: "m1",
      provenance: "meeting notes 2026-09-08",
    });
    assert.equal(svc.get(c.id)?.sourceType, "meeting");
    assert.equal(svc.get(c.id)?.meetingId, "m1");
  });

  it("completes and cancels commitments", () => {
    const svc = freshService();
    const c = svc.add({ userId: "u1", text: "Позвонить клиенту" });
    svc.update(c.id, { status: "completed" });
    assert.equal(svc.get(c.id)?.status, "completed");

    const c2 = svc.add({ userId: "u1", text: "Перенести встречу" });
    svc.update(c2.id, { status: "cancelled" });
    assert.equal(svc.get(c2.id)?.status, "cancelled");
  });

  it("refreshes due_soon/overdue from the due date", () => {
    const svc = freshService();
    const overdue = svc.add({
      userId: "u1",
      text: "Отчёт",
      dueDate: "2020-01-01T00:00:00Z",
    });
    const soon = svc.add({
      userId: "u1",
      text: "Звонок",
      dueDate: new Date(Date.now() + DUE_SOON_WINDOW_MS / 2).toISOString(),
    });

    svc.refreshStatuses();
    assert.equal(svc.get(overdue.id)?.status, "overdue");
    assert.equal(svc.get(soon.id)?.status, "due_soon");
  });
});
