/**
 * L1 — запись experience на завершении turn (idempotent by turnId).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TurnExperienceStore } from "../../src/runtime/learning/turn-experience.js";
import { recordTurnExperience } from "../../src/runtime/learning/record-turn-experience.js";

function makeStore(): TurnExperienceStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-wire-"));
  return new TurnExperienceStore({
    filePath: path.join(dir, "experiences.jsonl"),
    idFactory: () => `id-${Math.random().toString(36).slice(2, 8)}`,
    now: () => "2026-01-01T00:00:00Z",
  });
}

describe("recordTurnExperience (L1)", () => {
  it("record twice same turnId → one record (duplicate true second time)", () => {
    const store = makeStore();
    const input = { turnId: "t1", task: "сделать отчёт", success: true };

    const first = recordTurnExperience(store, input);
    const second = recordTurnExperience(store, input);

    assert.deepEqual(first, { ok: true, id: first.ok ? first.id : "", duplicate: false });
    assert.equal(second.ok, true);
    assert.equal((second as { duplicate: boolean }).duplicate, true);
    assert.equal(store.hasTurn("t1"), true);
    assert.equal(store.getByTurn("t1")?.id, (first as { id: string }).id);
  });

  it("success true/false сохраняется", () => {
    const store = makeStore();
    recordTurnExperience(store, { turnId: "ok", task: "x", success: true });
    recordTurnExperience(store, { turnId: "fail", task: "y", success: false, error: "boom" });

    assert.equal(store.getByTurn("ok")?.success, true);
    assert.equal(store.getByTurn("fail")?.success, false);
    assert.equal(store.getByTurn("fail")?.error, "boom");
  });

  it("durable: запись персистится в JSONL и переживает пересоздание store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-wire-"));
    const filePath = path.join(dir, "experiences.jsonl");
    const store = new TurnExperienceStore({ filePath });

    recordTurnExperience(store, { turnId: "p1", task: "персист", success: true });

    const raw = fs.readFileSync(filePath, "utf8");
    assert.equal(raw.trim().split("\n").length, 1);

    // Новый инстанс на том же файле видит старый turnId (идемпотентность после рестарта).
    const reloaded = new TurnExperienceStore({ filePath });
    assert.equal(reloaded.hasTurn("p1"), true);
    const dup = recordTurnExperience(reloaded, { turnId: "p1", task: "персист", success: true });
    assert.equal((dup as { duplicate: boolean }).duplicate, true);
  });

  it("recordTurnExperience: store.record throws → ok:false, no throw out", () => {
    const broken = {
      hasTurn: () => false,
      record: () => {
        throw new Error("disk full");
      },
    } as unknown as TurnExperienceStore;

    const result = recordTurnExperience(broken, { turnId: "x", task: "t", success: true });
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /disk full/);
  });

  it("recordTurnExperience: hasTurn throws → ok:false, no throw out", () => {
    const broken = {
      hasTurn: () => {
        throw new Error("io");
      },
      record: () => ({ id: "x" }),
    } as unknown as TurnExperienceStore;

    const result = recordTurnExperience(broken, { turnId: "x", task: "t", success: true });
    assert.equal(result.ok, false);
  });

  it("обрезка по лимитам: task/result/error не превышают лимиты", () => {
    const store = makeStore();
    const result = recordTurnExperience(store, {
      turnId: "big",
      task: "a".repeat(5000),
      assistantResponse: "b".repeat(9000),
      error: "c".repeat(3000),
      success: false,
    });
    assert.equal(result.ok, true);
    const rec = store.getByTurn("big")!;
    assert.ok(rec.task.length <= 2000);
    assert.ok((rec.result ?? "").length <= 4000);
    assert.ok((rec.error ?? "").length <= 1000);
  });
});
