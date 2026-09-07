import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SqliteRagMemoryService } from "../../.pi/extensions/sqlite-rag-memory/MemoryService.js";
import type { EmbeddingService } from "../../src/utils/embeddings.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "vector-memory.sqlite";

/**
 * Deterministic mock: synonyms map to the same dimensions, so semantically
 * related texts (that share few or no keywords) get similar vectors.
 */
class MockEmbeddingService implements EmbeddingService {
  private readonly dim = 8;

  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();
    const vec = new Float32Array(this.dim);
    const synonymGroups: Array<[string[], number]> = [
      [["concise", "summary", "summaries", "brief", "overview", "short"], 0],
      [["manager", "boss", "director"], 1],
      [["morning", "9am", "dawn"], 2],
      [["report", "document", "note"], 3],
      [["russian", "ru"], 4],
    ];
    for (const [syns, dim] of synonymGroups) {
      if (syns.some((w) => lower.includes(w))) vec[dim] += 1;
    }
    let h = 0;
    for (let i = 0; i < lower.length; i++) h = (h * 31 + lower.charCodeAt(i)) >>> 0;
    vec[this.dim - 1] = (h % 1000) / 1000;

    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    return Array.from(vec);
  }
}

let svc: SqliteRagMemoryService;

beforeEach(async () => {
  cleanTestDb(DB);
  svc = new SqliteRagMemoryService(new MockEmbeddingService());
  await svc.init(getTestDbPath(DB));
});

afterEach(async () => {
  await svc.close();
});

describe("vector memory", () => {
  it("stores embedding when adding a fact", async () => {
    const fact = await svc.addFact({
      content: "User prefers short bullet-point reports in Russian",
      category: "preference",
    });
    assert.ok(fact.embedding, "fact.embedding should be present");
    const emb = await svc.getEmbedding(fact.id);
    assert.ok(emb && emb.length > 0, "stored embedding should be retrievable");
  });

  it("finds fact by meaning (vector) with no shared keywords", async () => {
    await svc.addFact({
      content: "The manager likes concise daily summaries before 9am",
      category: "preference",
    });

    const results = await svc.search("brief morning overview preferred by boss");
    assert.ok(results.length >= 1);
    assert.ok(
      results.some(
        (r) =>
          r.content.toLowerCase().includes("concise") ||
          r.content.toLowerCase().includes("summaries"),
      ),
    );
  });

  it("hybrid search ranks the semantic match over a keyword-only match", async () => {
    await svc.addFact({ content: "morning meeting notes", category: "fact" });
    await svc.addFact({
      content: "The boss prefers a concise financial brief at dawn",
      category: "preference",
    });

    const results = await svc.search("manager wants a quick overview of finances in the morning");
    assert.ok(results.length >= 1);
    assert.ok(
      results[0].content.toLowerCase().includes("boss"),
      "semantic match should rank first",
    );
  });

  it("works without an embedding service (FTS-only fallback)", async () => {
    const dbName = "vector-memory-fts.sqlite";
    cleanTestDb(dbName);
    const plain = new SqliteRagMemoryService();
    await plain.init(getTestDbPath(dbName));
    try {
      await plain.addFact({ content: "Quarterly report is due Friday", category: "fact" });
      const res = await plain.search("report");
      assert.ok(res.length >= 1);
      assert.equal(res[0].source, "fts");
    } finally {
      await plain.close();
      cleanTestDb(dbName);
    }
  });
});
