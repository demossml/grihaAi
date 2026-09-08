import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContactService } from "../../.pi/extensions/crm/ContactService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "contact-service-test.sqlite";

function freshService(): ContactService {
  cleanTestDb(DB_NAME);
  const svc = new ContactService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("contact service", () => {
  it("upserts a contact with tags (case-insensitive dedupe)", () => {
    const svc = freshService();
    const a = svc.upsert("u1", "Иван", ["клиент"]);
    const b = svc.upsert("u1", "иван", ["vip"]);
    assert.equal(a.id, b.id);
    assert.deepEqual(svc.list("u1")[0].tags, ["vip"]);
  });

  it("isolates contacts per user", () => {
    const svc = freshService();
    svc.upsert("u1", "Иван");
    assert.equal(svc.list("u2").length, 0);
  });

  it("records last interaction", () => {
    const svc = freshService();
    const c = svc.upsert("u1", "Иван");
    assert.equal(c.lastInteractionAt, undefined);
    const touched = svc.touch(c.id);
    assert.ok(touched?.lastInteractionAt);
  });
});
