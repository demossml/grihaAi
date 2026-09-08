import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CalendarService } from "../../.pi/extensions/proactive-assistant/CalendarService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "calendar-service-test.sqlite";

function freshService(): CalendarService {
  cleanTestDb(DB_NAME);
  const svc = new CalendarService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("calendar service", () => {
  it("adds, lists and cancels events scoped to user", () => {
    const svc = freshService();
    const e = svc.add({
      userId: "u1",
      title: "Созвон",
      startsAt: "2026-09-08T06:00:00Z",
      endsAt: "2026-09-08T07:00:00Z",
      timezone: "Europe/Moscow",
      kind: "meeting",
      participants: ["Иван"],
    });
    assert.equal(e.kind, "meeting");
    assert.deepEqual(e.participants, ["Иван"]);

    assert.equal(svc.list("u1").length, 1);
    assert.equal(svc.list("u2").length, 0);

    svc.cancel(e.id);
    assert.equal(svc.get(e.id)?.status, "cancelled");
  });

  it("filters by time range", () => {
    const svc = freshService();
    svc.add({
      userId: "u1",
      title: "Вчера",
      startsAt: "2026-09-07T06:00:00Z",
      endsAt: "2026-09-07T07:00:00Z",
    });
    svc.add({
      userId: "u1",
      title: "Сегодня",
      startsAt: "2026-09-08T06:00:00Z",
      endsAt: "2026-09-08T07:00:00Z",
    });
    const from = "2026-09-08T00:00:00Z";
    assert.equal(svc.list("u1", { from }).length, 1);
    assert.equal(svc.list("u1", { from })[0].title, "Сегодня");
  });
});
