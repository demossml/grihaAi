/**
 * Wiring W2: E4 scan + E6 approval gate на write-path memory за флагом.
 * Flag off = старое поведение 1:1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SqliteRagMemoryService } from "../../.pi/extensions/sqlite-rag-memory/MemoryService.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "w2-memory.sqlite";

const fact = (over: Partial<Parameters<SqliteRagMemoryService["addFact"]>[0]> = {}) => ({
  content: "Клиент предпочитает email",
  category: "fact" as const,
  ...over,
});

describe("Memory write gate wiring (W2)", () => {
  it("flag off: старая запись проходит без гейтов (паритет)", async () => {
    cleanTestDb(DB);
    const svc = new SqliteRagMemoryService(undefined, {});
    await svc.init(getTestDbPath(DB));
    try {
      const written = await svc.addFact(fact({ content: "email\u200b.com" }));
      assert.ok(written.id);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("flag on: zero-width контент → блокировка записи (E4)", async () => {
    cleanTestDb(DB);
    const svc = new SqliteRagMemoryService(undefined, { HERMES_AGENT_RUNTIME: "1" });
    await svc.init(getTestDbPath(DB));
    try {
      await assert.rejects(svc.addFact(fact({ content: "email\u200b.com" })), /blocked/);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("flag on: goal-категория → требуется approval (E6)", async () => {
    cleanTestDb(DB);
    const svc = new SqliteRagMemoryService(undefined, { HERMES_AGENT_RUNTIME: "1" });
    await svc.init(getTestDbPath(DB));
    try {
      await assert.rejects(
        svc.addFact(fact({ category: "decision", content: "Цель: отпуск в марте" })),
        /requires approval/,
      );
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("flag on: обычный факт проходит (поведение без изменений)", async () => {
    cleanTestDb(DB);
    const svc = new SqliteRagMemoryService(undefined, { HERMES_AGENT_RUNTIME: "1" });
    await svc.init(getTestDbPath(DB));
    try {
      const written = await svc.addFact(fact());
      assert.ok(written.id);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("flag on: низкая confidence в metadata → approval (E6)", async () => {
    cleanTestDb(DB);
    const svc = new SqliteRagMemoryService(undefined, { HERMES_AGENT_RUNTIME: "1" });
    await svc.init(getTestDbPath(DB));
    try {
      await assert.rejects(
        svc.addFact(fact({ metadata: { confidence: 0.1 } })),
        /requires approval/,
      );
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});
