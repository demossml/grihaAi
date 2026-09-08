import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

/**
 * Integration test: real loading of the sqlite-vec extension and cosine
 * distance over raw float32 BLOB vectors (the same pattern MemoryService uses).
 */
describe("sqlite-vec integration", () => {
  it("loads the extension and computes cosine distance", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);

    const { vec_version } = db.prepare("select vec_version() as vec_version").get() as {
      vec_version: string;
    };
    assert.match(vec_version, /^v/);

    db.prepare("create table t(id text primary key, embedding blob)").run();
    db.prepare("insert into t(id, embedding) values (?, ?)").run(
      "a",
      Buffer.from(new Float32Array([1, 0, 0, 0]).buffer),
    );
    db.prepare("insert into t(id, embedding) values (?, ?)").run(
      "b",
      Buffer.from(new Float32Array([0, 1, 0, 0]).buffer),
    );

    const query = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
    const rows = db
      .prepare("select id, vec_distance_cosine(embedding, ?) as d from t order by d asc")
      .all(query) as Array<{ id: string; d: number }>;

    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[0].d, 0);
    assert.equal(rows[1].id, "b");
  });
});
