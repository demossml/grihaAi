import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TravelService } from "../../.pi/extensions/travel/TravelService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "travel-service-test.sqlite";

function freshService(): TravelService {
  cleanTestDb(DB_NAME);
  const svc = new TravelService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("travel service", () => {
  it("adds and lists itinerary items per trip", () => {
    const svc = freshService();
    svc.add({
      userId: "u1",
      tripId: "trip-1",
      kind: "flight",
      title: "SU 123",
      startsAt: "2026-09-10T08:00:00Z",
      endsAt: "2026-09-10T10:00:00Z",
    });
    svc.add({
      userId: "u1",
      tripId: "trip-1",
      kind: "hotel",
      title: "Hotel X",
      startsAt: "2026-09-10T14:00:00Z",
      endsAt: "2026-09-12T12:00:00Z",
    });
    assert.equal(svc.list("u1", "trip-1").length, 2);
    assert.equal(svc.list("u2").length, 0);
  });

  it("lists upcoming items within N days", () => {
    const svc = freshService();
    svc.add({
      userId: "u1",
      tripId: "t",
      kind: "flight",
      title: "soon",
      startsAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    });
    svc.add({
      userId: "u1",
      tripId: "t",
      kind: "flight",
      title: "later",
      startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3600000).toISOString(),
    });
    const upcoming = svc.upcoming("u1", 1);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].title, "soon");
  });
});
