/**
 * Item 4.1 (D2): scroll/browse контракт для поиска сессий.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildScrollCursor,
  parseScrollCursor,
  sliceByCursor,
  sqlOffsetFor,
} from "../../src/runtime/session/scroll.js";

describe("Session scroll (Item 4.1)", () => {
  it("roundtrip курсора", () => {
    const cursor = buildScrollCursor({ offset: 25, sortKey: -3.2 });
    assert.deepEqual(parseScrollCursor(cursor), { offset: 25, sortKey: -3.2 });
  });

  it("мусор/чужой префикс → null (не бросает)", () => {
    assert.equal(parseScrollCursor("garbage"), null);
    assert.equal(parseScrollCursor(null), null);
    assert.equal(parseScrollCursor(undefined), null);
    assert.equal(parseScrollCursor("x." + Buffer.from("{}").toString("base64url")), null);
  });

  it("отрицательный offset в курсоре → null", () => {
    const bad = "s1." + Buffer.from(JSON.stringify({ offset: -1 })).toString("base64url");
    assert.equal(parseScrollCursor(bad), null);
  });

  it("первая страница: items + nextCursor + hasMore", () => {
    const items = ["a", "b", "c", "d", "e"];
    const page = sliceByCursor(items, null, 2);
    assert.deepEqual(page.items, ["a", "b"]);
    assert.equal(page.hasMore, true);
    assert.ok(page.nextCursor);
  });

  it("вторая страница по nextCursor, затем конец", () => {
    const items = ["a", "b", "c", "d", "e"];
    const p1 = sliceByCursor(items, null, 2);
    const p2 = sliceByCursor(items, p1.nextCursor, 2);
    assert.deepEqual(p2.items, ["c", "d"]);
    const p3 = sliceByCursor(items, p2.nextCursor, 2);
    assert.deepEqual(p3.items, ["e"]);
    assert.equal(p3.hasMore, false);
    assert.equal(p3.nextCursor, null);
  });

  it("мусорный курсор в slice → трактуется как начало", () => {
    const items = ["a", "b"];
    assert.deepEqual(sliceByCursor(items, "garbage", 2).items, ["a", "b"]);
  });

  it("sqlOffsetFor: offset для будущего SQL-wiring", () => {
    assert.equal(sqlOffsetFor(null), 0);
    assert.equal(sqlOffsetFor(buildScrollCursor({ offset: 40 })), 40);
  });
});
