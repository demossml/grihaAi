/**
 * P02: cron → Telegram — доставка (execution ≠ delivery), ретраи, миграции,
 * авторизация target (cron-auth).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import {
  CronService,
  type CronRunner,
} from "../../.pi/extensions/cron/CronService.js";
import type { CronDelivery } from "../../.pi/extensions/cron/cron-bridge.js";
import { assertTargetAllowed } from "../../.pi/extensions/cron/cron-auth.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "cron-telegram.sqlite";

function makeDelivery(
  calls: Array<{ chatId: string; threadId?: string; text: string }>,
  handler: (call: number) => Promise<{ ok: boolean; permanent?: boolean; error?: string }>,
): CronDelivery {
  return async (chatId, threadId, text) => {
    calls.push({ chatId, threadId, text });
    return handler(calls.length);
  };
}

describe("cron telegram delivery (P02)", () => {
  it("job без target → доставка не вызывается, deliveryStatus undefined", async () => {
    cleanTestDb(DB);
    const calls: Array<unknown> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "res", usedLlm: true }),
      undefined,
      undefined,
      () => makeDelivery(calls as never, async () => ({ ok: true })),
      10,
      2,
    );
    await svc.init();
    try {
      const job = await svc.createJob({ name: "plain", schedule: "every 1 minute", prompt: "p" });
      assert.equal(job.chatId, undefined);
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, undefined);
      assert.equal(calls.length, 0);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("DM target → доставка успешна, deliveryStatus=ok, статус задачи success", async () => {
    cleanTestDb(DB);
    const calls: Array<{ chatId: string; threadId?: string; text: string }> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "итог", usedLlm: true }),
      undefined,
      undefined,
      () => makeDelivery(calls, async () => ({ ok: true })),
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "dm",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "42" },
      });
      assert.equal(job.chatId, "42");
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, "ok");
      assert.deepEqual(calls, [{ chatId: "42", threadId: undefined, text: "итог" }]);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("group+thread target → threadId передаётся в доставку", async () => {
    cleanTestDb(DB);
    const calls: Array<{ chatId: string; threadId?: string; text: string }> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "x", usedLlm: true }),
      undefined,
      undefined,
      () => makeDelivery(calls, async () => ({ ok: true })),
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "topic",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-100123", threadId: "7" },
      });
      assert.equal(job.chatId, "-100123");
      assert.equal(job.threadId, "7");
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.deliveryStatus, "ok");
      assert.deepEqual(calls, [{ chatId: "-100123", threadId: "7", text: "x" }]);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("временная ошибка → ограниченный retry (3 попытки) → ok", async () => {
    cleanTestDb(DB);
    const calls: Array<unknown> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "x", usedLlm: true }),
      undefined,
      undefined,
      () =>
        makeDelivery(calls as never, async (n) =>
          n < 3 ? { ok: false } : { ok: true },
        ),
      5,
      2,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "retry",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-1001" },
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, "ok");
      assert.equal(calls.length, 3);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("permanent failure → без повторов, deliveryStatus=permanent_failure, статус success", async () => {
    cleanTestDb(DB);
    const calls: Array<unknown> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "x", usedLlm: true }),
      undefined,
      undefined,
      () =>
        makeDelivery(calls as never, async () => ({
          ok: false,
          permanent: true,
          error: "chat not found",
        })),
      5,
      5,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "perm",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-999999" },
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, "permanent_failure");
      assert.equal(calls.length, 1);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("временная ошибка без восстановления → deliveryStatus=failed", async () => {
    cleanTestDb(DB);
    const calls: Array<unknown> = [];
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "x", usedLlm: true }),
      undefined,
      undefined,
      () => makeDelivery(calls as never, async () => ({ ok: false, error: "timeout" })),
      5,
      2,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "fail",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-1001" },
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, "failed");
      assert.equal(calls.length, 3);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("мост не зарегистрирован → deliveryStatus=skipped с диагностикой", async () => {
    cleanTestDb(DB);
    const svc = new CronService(
      getTestDbPath(DB),
      async () => ({ result: "x", usedLlm: true }),
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "nobridge",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-1001" },
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "success");
      assert.equal(rec.deliveryStatus, "skipped");
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("старая БД (без новых колонок) → идемпотентная миграция, target работает", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-old-"));
    const dbPath = path.join(dir, "cron.sqlite");
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE cron_jobs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule TEXT NOT NULL,
        prompt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        continuity INTEGER NOT NULL DEFAULT 0, monitor_mode INTEGER NOT NULL DEFAULT 0,
        last_run_at TEXT, last_result TEXT, state_snapshot TEXT, notepad TEXT,
        project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE cron_runs (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL,
        finished_at TEXT, status TEXT NOT NULL, result TEXT, used_llm INTEGER NOT NULL DEFAULT 0
      );
    `);
    raw
      .prepare(
        `INSERT INTO cron_jobs (id, name, schedule, prompt, enabled, continuity, monitor_mode, created_at, updated_at)
         VALUES ('old1', 'old', 'every 1 minute', 'p', 1, 0, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run();
    raw.close();

    const svc = new CronService(
      dbPath,
      async () => ({ result: "x", usedLlm: true }),
      undefined,
      undefined,
      () => async () => ({ ok: true }),
    );
    await svc.init();
    try {
      const old = await svc.getJob("old1");
      assert.ok(old, "старый job читается");
      assert.equal(old.chatId, undefined, "старый job без target");
      const job = await svc.createJob({
        name: "new",
        schedule: "every 1 minute",
        prompt: "p",
        telegramTarget: { chatId: "-1005", threadId: "3" },
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.deliveryStatus, "ok");
    } finally {
      await svc.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restart: target переживает переоткрытие сервиса", async () => {
    cleanTestDb(DB);
    const calls: Array<{ chatId: string; threadId?: string; text: string }> = [];
    const mk = () =>
      new CronService(
        getTestDbPath(DB),
        async () => ({ result: "x", usedLlm: true }),
        undefined,
        undefined,
        () => makeDelivery(calls, async () => ({ ok: true })),
      );
    const svc1 = mk();
    await svc1.init();
    const job = await svc1.createJob({
      name: "restart",
      schedule: "every 1 minute",
      prompt: "p",
      telegramTarget: { chatId: "-1007" },
    });
    await svc1.close();

    const svc2 = mk();
    await svc2.init();
    try {
      const reloaded = await svc2.getJob(job.id);
      assert.equal(reloaded?.chatId, "-1007");
      const rec = await svc2.runJobNow(job.id);
      assert.equal(rec.deliveryStatus, "ok");
    } finally {
      await svc2.close();
      cleanTestDb(DB);
    }
  });

  it("disabled job → tick не запускает", async () => {
    cleanTestDb(DB);
    const runnerCalls: string[] = [];
    const svc = new CronService(getTestDbPath(DB), async (j) => {
      runnerCalls.push(j.id);
      return { result: "x", usedLlm: true };
    });
    await svc.init();
    try {
      await svc.createJob({
        name: "off",
        schedule: "every 1 minute",
        prompt: "p",
        enabled: false,
      });
      const recs = await svc.tick();
      assert.equal(recs.length, 0);
      assert.equal(runnerCalls.length, 0);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});

describe("cron target authorization (P02)", () => {
  const auth = (input: Partial<Parameters<typeof assertTargetAllowed>[0]> = {}) =>
    assertTargetAllowed({
      actor: "7",
      targetChatId: "-1001",
      canManage: async () => false,
      getChatMember: async () => "member",
      ...input,
    });

  it("global owner/admin (canManage) → allow", async () => {
    assert.deepEqual(await auth({ canManage: async () => true }), { ok: true });
  });

  it("group administrator → allow", async () => {
    assert.deepEqual(await auth({ getChatMember: async () => "administrator" }), { ok: true });
  });

  it("group creator → allow", async () => {
    assert.deepEqual(await auth({ getChatMember: async () => "creator" }), { ok: true });
  });

  it("ordinary member → deny", async () => {
    assert.deepEqual(await auth({ getChatMember: async () => "member" }), {
      ok: false,
      reason: "Нужны права администратора группы.",
    });
  });

  it("свой DM (target == sessionChatId, не группа) → allow", async () => {
    assert.deepEqual(
      await auth({ targetChatId: "42", sessionChatId: "42", getChatMember: undefined }),
      { ok: true },
    );
  });

  it("чужой DM → deny (проверяется group-path)", async () => {
    assert.deepEqual(
      await auth({ targetChatId: "43", sessionChatId: "42", getChatMember: async () => "member" }),
      { ok: false, reason: "Нужны права администратора группы." },
    );
  });

  it("нет getChatMember → fail closed", async () => {
    assert.deepEqual(await auth({ getChatMember: undefined }), {
      ok: false,
      reason: "Нет возможности проверить права.",
    });
  });

  it("getChatMember бросил → fail closed", async () => {
    assert.deepEqual(
      await auth({
        getChatMember: async () => {
          throw new Error("network");
        },
      }),
      { ok: false, reason: "Не удалось проверить права, попробуйте позже." },
    );
  });

  it("canManage бросил → трактуется как false", async () => {
    assert.deepEqual(
      await auth({
        canManage: async () => {
          throw new Error("store error");
        },
        getChatMember: async () => "member",
      }),
      { ok: false, reason: "Нужны права администратора группы." },
    );
  });
});
