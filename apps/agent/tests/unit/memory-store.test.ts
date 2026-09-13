/**
 * Item 5.2 (E5): InMemoryMemoryStore — remember/recall/forget/reinforce/contradict.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMemoryStore } from "../../src/runtime/memory/store.js";
import type { MemoryInput } from "../../src/runtime/memory/types.js";

const input = (over: Partial<MemoryInput> = {}): MemoryInput => ({
  type: "fact",
  content: "Клиент предпочитает email",
  source: "chat",
  confidence: 0.9,
  ...over,
});

let idSeq = 0;
const makeStore = () => new InMemoryMemoryStore({ idFactory: () => `t${++idSeq}` });

describe("InMemoryMemoryStore (Item 5.2)", () => {
  it("remember: persist новой записи", async () => {
    const store = makeStore();
    const record = await store.remember(input());
    assert.equal(record.status, "confirmed");
    assert.equal(record.type, "fact");
    assert.ok(record.id.startsWith("t"));
  });

  it("remember: reject по низкой confidence", async () => {
    const store = makeStore();
    await assert.rejects(store.remember(input({ confidence: 0.1 })), /rejected/);
    assert.equal(store.list().length, 0);
  });

  it("remember: near-duplicate → reinforce без новой записи", async () => {
    const store = makeStore();
    const first = await store.remember(input());
    const again = await store.remember(input({ content: "клиент предпочитает email" }));
    assert.equal(store.list().length, 1);
    assert.ok(again.confidence > first.confidence);
  });

  it("remember: противоречие → новая запись + старая contradicted", async () => {
    const store = makeStore();
    const first = await store.remember(input());
    await store.remember(input({ content: "Клиент не предпочитает email" }));
    const all = store.list();
    assert.equal(all.length, 2);
    const old = all.find((r) => r.id === first.id);
    assert.equal(old?.status, "contradicted");
  });

  it("recall: фильтры text/type/status", async () => {
    const store = makeStore();
    await store.remember(input({ content: "Любит зелёный чай", type: "preference", confidence: 0.5 }));
    await store.remember(input());
    const facts = await store.recall({ type: "fact" });
    assert.equal(facts.length, 1);
    const byText = await store.recall({ text: "чай" });
    assert.equal(byText.length, 1);
    const confirmed = await store.recall({ status: "confirmed" });
    assert.equal(confirmed.length, 1);
  });

  it("forget по criteria", async () => {
    const store = makeStore();
    const r = await store.remember(input());
    await store.remember(input({ content: "Другое", type: "preference" }));
    await store.forget({ id: r.id });
    assert.equal(store.list().length, 1);
  });

  it("reinforce/contradict по id, неизвестный id → ошибка", async () => {
    const store = makeStore();
    const r = await store.remember(input({ confidence: 0.5 }));
    await store.reinforce(r.id);
    assert.ok(store.list()[0].confidence > 0.5);
    await store.contradict(r.id);
    assert.equal(store.list()[0].status, "contradicted");
    await assert.rejects(store.reinforce("missing"), /not found/);
  });
});
