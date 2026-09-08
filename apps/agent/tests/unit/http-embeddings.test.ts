import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpEmbeddingService } from "../../src/utils/http-embeddings.js";

function fakeFetch(payload: unknown, ok = true, status = 200) {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => (ok ? "" : "boom"),
  })) as unknown as typeof fetch;
}

describe("HttpEmbeddingService", () => {
  it("embeds a single text via the /embeddings endpoint", async () => {
    const svc = new HttpEmbeddingService({
      baseUrl: "https://api.example.com/v1",
      model: "text-embedding-3-small",
      apiKey: "sk-test",
      fetchFn: fakeFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });
    const vec = await svc.embed("hello");
    assert.deepEqual(vec, [0.1, 0.2, 0.3]);
  });

  it("batches multiple texts", async () => {
    const svc = new HttpEmbeddingService({
      baseUrl: "https://api.example.com/v1/",
      model: "m",
      apiKey: "k",
      fetchFn: fakeFetch({ data: [{ embedding: [1] }, { embedding: [2] }] }),
    });
    const vecs = await svc.embedBatch(["a", "b"]);
    assert.deepEqual(vecs, [[1], [2]]);
  });

  it("posts to {baseUrl}/embeddings with the model and auth header", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [1] }] }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    const svc = new HttpEmbeddingService({
      baseUrl: "https://api.example.com/v1/",
      model: "m",
      apiKey: "k",
      fetchFn,
    });
    await svc.embed("hi");

    assert.equal(captured.url, "https://api.example.com/v1/embeddings");
    assert.equal(
      (captured.init!.headers as Record<string, string>).Authorization,
      "Bearer k",
    );
  });

  it("throws on a non-ok response", async () => {
    const svc = new HttpEmbeddingService({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      fetchFn: fakeFetch({ data: [] }, false, 401),
    });
    await assert.rejects(() => svc.embed("x"), /Embedding API error 401/);
  });
});
