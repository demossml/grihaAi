import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UserProfileService } from "../../../.pi/extensions/sqlite-rag-memory/UserProfileService.js";
import { ClientNotesService } from "../../../.pi/extensions/sqlite-rag-memory/ClientNotesService.js";
import { extractLearning, isExtractionEmpty, summarizeExtraction } from "../../../src/utils/learning/learning-extractor.js";
import { formatPersonalContext } from "../../../src/utils/learning/personal-context.js";
import type { ClientNote, UserProfile } from "../../../src/types/index.js";
import { cleanTestDb, getTestDbPath } from "../../setup.js";

const DB = "personal-learning.sqlite";

describe("user profile service", () => {
  it("creates and updates a UserProfile", async () => {
    cleanTestDb(DB);
    const svc = new UserProfileService(getTestDbPath(DB));
    await svc.init();
    try {
      const profile = await svc.upsertProfile("owner", {
        displayName: "Дима",
        preferences: { reports: "таблица" },
      });
      assert.equal(profile.displayName, "Дима");

      await svc.setPreference("owner", "style", "коротко");
      const updated = await svc.getProfile("owner");
      assert.equal(updated?.preferences.style, "коротко");
      assert.equal(updated?.preferences.reports, "таблица");
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("does not mix data between different userIds", async () => {
    cleanTestDb(DB);
    const profiles = new UserProfileService(getTestDbPath(DB));
    const notes = new ClientNotesService(getTestDbPath(DB));
    await profiles.init();
    await notes.init();
    try {
      await profiles.upsertProfile("u1", { preferences: { lang: "ru" } });
      await profiles.upsertProfile("u2", { preferences: { lang: "en" } });
      assert.equal((await profiles.getProfile("u1"))?.preferences.lang, "ru");
      assert.equal((await profiles.getProfile("u2"))?.preferences.lang, "en");

      await notes.addNote({ userId: "u1", content: "note A", category: "procedure" });
      await notes.addNote({ userId: "u2", content: "note B", category: "procedure" });
      const u1Notes = await notes.listNotes("u1");
      assert.equal(u1Notes.length, 1);
      assert.equal(u1Notes[0].content, "note A");
    } finally {
      await notes.close();
      await profiles.close();
      cleanTestDb(DB);
    }
  });
});

describe("client notes service", () => {
  it("adds and searches client notes", async () => {
    cleanTestDb(DB);
    const svc = new ClientNotesService(getTestDbPath(DB));
    await svc.init();
    try {
      await svc.addNote({
        userId: "owner",
        content: "Когда просят сводку — всегда за текущую неделю",
        category: "procedure",
      });
      const found = await svc.searchNotes("owner", "сводку");
      assert.ok(found.length >= 1);
      assert.equal(found[0].content, "Когда просят сводку — всегда за текущую неделю");
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});

describe("learning extraction", () => {
  it("returns a structured result (mock LLM)", async () => {
    const result = await extractLearning(
      "Пользователь: я предпочитаю отчёты в таблице",
      async () => JSON.stringify({ facts: ["f1"], preferences: { reports: "table" }, notes: ["n1"] }),
    );
    assert.deepEqual(result.facts, ["f1"]);
    assert.deepEqual(result.preferences, { reports: "table" });
    assert.deepEqual(result.notes, ["n1"]);
  });

  it("returns empty on malformed LLM output", async () => {
    const result = await extractLearning("dialog", async () => "не json");
    assert.deepEqual(result, { facts: [], preferences: {}, notes: [] });
  });

  it("isExtractionEmpty and summarizeExtraction work", () => {
    assert.equal(isExtractionEmpty({ facts: [], preferences: {}, notes: [] }), true);
    assert.equal(isExtractionEmpty({ facts: ["f"], preferences: {}, notes: [] }), false);

    const summary = summarizeExtraction({
      facts: ["f1"],
      preferences: { a: "b" },
      notes: ["n1"],
    });
    assert.match(summary, /f1/);
    assert.match(summary, /a: b/);
    assert.match(summary, /n1/);
  });
});

describe("personal context", () => {
  it("includes profile and notes in the context", () => {
    const profile: UserProfile = {
      userId: "owner",
      displayName: "Дима",
      communicationStyle: "коротко",
      preferences: { отчёты: "таблица" },
      updatedAt: new Date().toISOString(),
    };
    const notes: ClientNote[] = [
      {
        id: "1",
        userId: "owner",
        content: "Сводка — за неделю",
        category: "procedure",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const ctx = formatPersonalContext(profile, notes);
    assert.match(ctx, /Дима/);
    assert.match(ctx, /Сводка — за неделю/);
  });
});
