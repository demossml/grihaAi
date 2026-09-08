import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
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

  it("stores the domain contract aliases (actor/action/target/deadline)", () => {
    const svc = freshService();
    const c = svc.add({
      userId: "u1",
      text: "Отправить договор",
      actor: "Гриша",
      target: "Иван",
      deadline: "2026-09-20T00:00:00Z",
      source: "message",
      sourceMessageId: "msg-123",
    });
    const stored = svc.get(c.id)!;
    assert.equal(stored.actor, "Гриша");
    assert.equal(stored.target, "Иван");
    assert.equal(stored.deadline, "2026-09-20T00:00:00Z");
    assert.equal(stored.sourceMessageId, "msg-123");
    // Legacy fields stay populated for backward compatibility.
    assert.equal(stored.who, "Гриша");
    assert.equal(stored.dueDate, "2026-09-20T00:00:00Z");
  });

  it("records completedAt when completing", () => {
    const svc = freshService();
    const c = svc.add({ userId: "u1", text: "Позвонить" });
    assert.equal(svc.get(c.id)?.completedAt, undefined);
    svc.update(c.id, { status: "completed" });
    assert.ok(svc.get(c.id)?.completedAt);
  });

  it("dueSoon() and overdue() return derived views", () => {
    const svc = freshService();
    const overdue = svc.add({ userId: "u1", text: "A", dueDate: "2020-01-01T00:00:00Z" });
    const soon = svc.add({
      userId: "u1",
      text: "B",
      dueDate: new Date(Date.now() + DUE_SOON_WINDOW_MS / 2).toISOString(),
    });
    svc.refreshStatuses();
    assert.deepEqual(
      svc.overdue("u1").map((c) => c.id),
      [overdue.id],
    );
    assert.deepEqual(
      svc.dueSoon("u1").map((c) => c.id),
      [soon.id],
    );
  });

  it("migrates a legacy DB by adding the new columns", () => {
    cleanTestDb("commitment-legacy-test.sqlite");
    const legacy = new Database(getTestDbPath("commitment-legacy-test.sqlite"));
    // Simulate the pre-contract schema (without the new columns).
    legacy.exec(`
      CREATE TABLE commitments (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, who TEXT,
        to_whom TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'open',
        source_type TEXT, source_id TEXT, contact_id TEXT, meeting_id TEXT,
        confidence REAL NOT NULL DEFAULT 1, provenance TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const svc = new CommitmentService(getTestDbPath("commitment-legacy-test.sqlite"));
    svc.init();
    const c = svc.add({ userId: "u1", text: "x", actor: "A" });
    assert.ok(svc.get(c.id)?.actor);
    svc.close();
  });
});
