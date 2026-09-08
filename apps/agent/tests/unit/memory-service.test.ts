import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RECENCY_HALF_LIFE_MS,
  SqliteRagMemoryService,
  recencyFactor,
  reciprocalRankFusion,
} from "../../.pi/extensions/sqlite-rag-memory/MemoryService.js";
import type { SearchResult } from "../../src/types/index.js";
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

  it("deleteFact removes the fact and it disappears from search", async () => {
    const fact = await svc.addFact({ content: "Delete me please", category: "fact" });
    assert.ok((await svc.search("Delete me please")).some((r) => r.id === fact.id));

    assert.equal(await svc.deleteFact(fact.id), true);
    assert.ok(!(await svc.search("Delete me please")).some((r) => r.id === fact.id));

    // Повторное удаление — уже нет записи.
    assert.equal(await svc.deleteFact(fact.id), false);
  });

  it("addFact deduplicates near-exact content and refreshes updated_at", async () => {
    const first = await svc.addFact({ content: "Manager prefers morning meetings", category: "preference" });
    await new Promise((r) => setTimeout(r, 5)); // разнесём ISO-штампы
    const second = await svc.addFact({ content: "  manager prefers   MORNING meetings ", category: "preference" });

    // Дубль не создан: тот же id, поиск возвращает одну запись.
    assert.equal(second.id, first.id);
    const res = await svc.search("morning meetings");
    assert.equal(res.length, 1);

    // Повторное подтверждение делает факт «свежим» (recency).
    assert.ok(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt));
  });

  it("addFact does not deduplicate facts from a different category/scope", async () => {
    await svc.addFact({ content: "Manager prefers morning meetings", category: "preference" });
    await svc.addFact({ content: "Manager prefers morning meetings", category: "fact" });
    await svc.addFact({ content: "Manager prefers morning meetings", category: "preference", projectId: "p1" });

    assert.equal((await svc.search("morning meetings")).length, 3);
  });
});

describe("reciprocalRankFusion recency", () => {
  const make = (id: string, updatedAt: string): SearchResult => ({
    id,
    content: id,
    score: 0,
    source: "fts",
    updatedAt,
  });

  it("newer fact ranks above an equally relevant older fact", () => {
    const now = Date.now();
    const newer = make("new", new Date(now).toISOString());
    const older = make("old", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString());

    const fused = reciprocalRankFusion([newer], [older], 2);
    assert.equal(fused.length, 2);
    assert.equal(fused[0].id, "new");
    assert.ok(fused[0].score > fused[1].score);
  });

  it("without updatedAt scores stay equal (no recency applied)", () => {
    const a: SearchResult = { id: "a", content: "a", score: 0, source: "fts" };
    const b: SearchResult = { id: "b", content: "b", score: 0, source: "fts" };
    const fused = reciprocalRankFusion([a], [b], 2);
    assert.equal(fused.length, 2);
    assert.equal(fused[0].score, fused[1].score);
  });

  it("recencyFactor is 1 for fresh facts and bounded ≥0.5 for old ones", () => {
    const now = Date.now();
    assert.equal(recencyFactor(new Date(now).toISOString(), now, DEFAULT_RECENCY_HALF_LIFE_MS), 1);
    const ancient = recencyFactor(
      new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
      now,
      DEFAULT_RECENCY_HALF_LIFE_MS,
    );
    assert.ok(ancient >= 0.5 && ancient < 1, `expected [0.5, 1), got ${ancient}`);
    assert.equal(recencyFactor(undefined, now, DEFAULT_RECENCY_HALF_LIFE_MS), 1);
  });
});
