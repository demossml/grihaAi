import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { UserProfileService } from "../../../.pi/extensions/sqlite-rag-memory/UserProfileService.js";
import { ClientNotesService } from "../../../.pi/extensions/sqlite-rag-memory/ClientNotesService.js";
import { createHttpLearningLlm } from "../../../src/utils/learning/http-learning.js";
import { applyLearning, extractLearning } from "../../../src/utils/learning/learning-extractor.js";
import { cleanTestDb, getTestDbPath } from "../../setup.js";

const DB = "learning-schema.sqlite";

const extractionJson = JSON.stringify({
  facts: ["Любит сводки по утрам"],
  preferences: { формат: "кратко" },
  notes: ["При отчётах сначала смотреть данные продаж"],
});

describe("real learning call keeps the storage schema intact", () => {
  it("writes extraction via the real llm without corrupting tables", async () => {
    cleanTestDb(DB);
    const dbPath = getTestDbPath(DB);
    const profiles = new UserProfileService(dbPath);
    const notes = new ClientNotesService(dbPath);
    await profiles.init();
    await notes.init();
    try {
      const fetchFn = (async () => ({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ choices: [{ message: { content: extractionJson } }] }),
      })) as unknown as typeof fetch;

      const llm = createHttpLearningLlm(
        {
          version: 1,
          provider: "deepseek",
          model: "deepseek-chat",
          apiKey: "k",
          setupCompletedAt: "x",
        },
        { fetchFn },
      );

      const extraction = await extractLearning("Пользователь: делай кратко", llm);
      const saved = await applyLearning(extraction, "owner", profiles, notes);

      assert.equal(saved.preferencesSaved, 1);
      assert.equal(saved.notesSaved, 2);

      // Schema intact: tables and columns still exist after the write.
      const db = new Database(dbPath, { readonly: true });
      try {
        const tables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_profiles','client_notes')`)
          .all() as Array<{ name: string }>;
        assert.equal(tables.length, 2);

        const profileCols = db.prepare(`PRAGMA table_info(user_profiles)`).all() as Array<{ name: string }>;
        assert.ok(profileCols.some((c) => c.name === "preferences"));

        const noteCols = db.prepare(`PRAGMA table_info(client_notes)`).all() as Array<{ name: string }>;
        assert.ok(noteCols.some((c) => c.name === "category"));
      } finally {
        db.close();
      }

      // Data is readable back through the services (not corrupted).
      const profile = await profiles.getProfile("owner");
      assert.equal(profile?.preferences["формат"], "кратко");
      assert.equal((await notes.listNotes("owner")).length, 2);
    } finally {
      await profiles.close();
      await notes.close();
      cleanTestDb(DB);
    }
  });
});
