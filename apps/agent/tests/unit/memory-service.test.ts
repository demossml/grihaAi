import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SqliteRagMemoryService } from "../../.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "memory-service.sqlite";
let svc: SqliteRagMemoryService;

beforeEach(async () => {
  cleanTestDb(DB);
  svc = new SqliteRagMemoryService();
  await svc.init(getTestDbPath(DB));
});

describe("MemoryService", () => {
  it("adds and searches facts", async () => {
    await svc.addFact({ content: "Manager prefers morning meetings", category: "preference" });
    await svc.addFact({ content: "Quarterly report is due Friday", category: "fact" });

    const res = await svc.search("morning meetings");
    assert.equal(res.length, 1);
    assert.equal(res[0].content, "Manager prefers morning meetings");
    assert.equal(res[0].source, "fts");
  });

  it("stores and retrieves session messages", async () => {
    const m1 = await svc.addMessage({ sessionId: "s1", role: "user", content: "Book a meeting" });
    const m2 = await svc.addMessage({ sessionId: "s1", role: "assistant", content: "Booked for 10:00" });

    const msgs = await svc.getSessionMessages("s1");
    assert.equal(msgs.length, 2);
    assert.deepEqual(msgs.map((m) => m.id), [m1.id, m2.id]);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
  });

  it("searches sessions via FTS5", async () => {
    await svc.addMessage({ sessionId: "s1", role: "user", content: "Prepare invoice for client" });
    await svc.addMessage({ sessionId: "s2", role: "user", content: "Schedule dentist appointment" });

    const res = await svc.searchSessions("invoice");
    assert.equal(res.length, 1);
    assert.equal(res[0].metadata?.sessionId, "s1");
  });

  it("filters facts by projectId and botId", async () => {
    await svc.addFact({ content: "Shared note", category: "fact" });
    await svc.addFact({ content: "Project alpha note", category: "fact", projectId: "p1", botId: "b1" });

    const byProject = await svc.search("note", { projectId: "p1" });
    assert.equal(byProject.length, 1);
    assert.equal(byProject[0].content, "Project alpha note");

    const byBot = await svc.search("note", { botId: "b1" });
    assert.equal(byBot.length, 1);
    assert.equal(byBot[0].content, "Project alpha note");

    const none = await svc.search("note", { projectId: "p2" });
    assert.equal(none.length, 0);
  });

  it("lists recent facts, optionally by project", async () => {
    await svc.addFact({ content: "First fact", category: "fact" });
    await svc.addFact({ content: "Second fact", category: "fact", projectId: "p1" });

    const all = await svc.listRecentFacts(10);
    assert.equal(all.length, 2);

    const p1 = await svc.listRecentFacts(10, "p1");
    assert.equal(p1.length, 1);
    assert.equal(p1[0].content, "Second fact");
  });
});
