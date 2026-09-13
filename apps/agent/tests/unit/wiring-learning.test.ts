/**
 * Wiring W5: маршрутизация уроков в applyLearning за флагом (G2).
 * Flag off = persist-поведение 1:1, routes отсутствуют.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyLearning } from "../../src/utils/learning/learning-extractor.js";
import type { ProfileStore, NotesStore } from "../../src/utils/learning/learning-extractor.js";

const profiles: ProfileStore = {
  async setPreference() {},
};

const notes: NotesStore = {
  async addNote(note) {
    return { id: "n1", ...note, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  },
};

const extraction = {
  facts: ["Почта клиента: a@b.ru"],
  preferences: { стиль: "предпочитает короткие отчёты" },
  notes: ["Каждый раз сначала проверяй курс валют, потом считай"],
};

describe("Learning wiring (W5)", () => {
  it("flag off: persist как раньше, routes отсутствуют", async () => {
    const result = await applyLearning(extraction, "u1", profiles, notes, { env: {} });
    assert.equal(result.preferencesSaved, 1);
    assert.equal(result.notesSaved, 2);
    assert.equal(result.routes, undefined);
  });

  it("flag on: routes возвращаются, persist не меняется", async () => {
    const result = await applyLearning(extraction, "u1", profiles, notes, {
      env: { HERMES_AGENT_RUNTIME: "1" },
    });
    assert.equal(result.preferencesSaved, 1);
    assert.equal(result.notesSaved, 2);
    assert.ok(result.routes);
    assert.equal(result.routes?.length, 3);
  });

  it("flag on: factual→memory, procedural→skill, preference→user-model", async () => {
    const result = await applyLearning(extraction, "u1", profiles, notes, {
      env: { HERMES_AGENT_RUNTIME: "1" },
    });
    const targets = result.routes?.map((r) => r.target);
    assert.ok(targets?.includes("memory"));
    assert.ok(targets?.includes("skill"));
    assert.ok(targets?.includes("user-model"));
  });

  it("flag on: неклассифицируемое → drop", async () => {
    const result = await applyLearning(
      { facts: ["ок"], preferences: {}, notes: [] },
      "u1",
      profiles,
      notes,
      { env: { HERMES_AGENT_RUNTIME: "1" } },
    );
    assert.equal(result.routes?.[0].target, "drop");
  });
});
