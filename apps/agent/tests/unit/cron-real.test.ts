import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CronService } from "../../.pi/extensions/cron/CronService.js";
import {
  computeCronStateSnapshot,
  createRealCronChangeDetector,
  createRealCronRunner,
} from "../../.pi/extensions/cron/real-cron.js";
import type { SubAgentRunner } from "../../.pi/extensions/multi-agent/SubAgentManager.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "cron-real.sqlite";

describe("real cron runner (controllable clock)", () => {
  it("runs due jobs through the SubAgentRunner and respects the schedule", async () => {
    cleanTestDb(DB);
    const goals: string[] = [];
    const subRunner: SubAgentRunner = async (task) => {
      goals.push(task.goal);
      return { result: "ok" };
    };

    let now = new Date("2026-09-08T10:00:00Z");
    const svc = new CronService(
      getTestDbPath(DB),
      createRealCronRunner(subRunner),
      undefined,
      () => now,
    );
    await svc.init();
    try {
      await svc.createJob({ name: "t", schedule: "every 1 minute", prompt: "hello" });

      const r1 = await svc.tick();
      assert.equal(r1.length, 1);
      assert.equal(r1[0].usedLlm, true);
      assert.deepEqual(goals, ["hello"]);

      // 30 seconds later — not due.
      now = new Date("2026-09-08T10:00:30Z");
      assert.equal((await svc.tick()).length, 0);

      // 1 minute later — due again.
      now = new Date("2026-09-08T10:01:00Z");
      const r3 = await svc.tick();
      assert.equal(r3.length, 1);
      assert.deepEqual(goals, ["hello", "hello"]);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("scopes each cron run to a fresh subtreeSessionId", async () => {
    cleanTestDb(DB);
    const sessionIds: string[] = [];
    const subRunner: SubAgentRunner = async (task) => {
      sessionIds.push(task.subtreeSessionId);
      return { result: "ok" };
    };
    const svc = new CronService(getTestDbPath(DB), createRealCronRunner(subRunner));
    await svc.init();
    try {
      const job = await svc.createJob({ name: "t", schedule: "every 1 minute", prompt: "p" });
      await svc.runJobNow(job.id);
      await svc.runJobNow(job.id);
      assert.equal(sessionIds.length, 2);
      assert.notEqual(sessionIds[0], sessionIds[1]);
      assert.match(sessionIds[0], /^cron:/);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});

describe("real cron change detector (monitorMode)", () => {
  it("skips when nothing changed and runs again after an external edit", async () => {
    cleanTestDb(DB);
    let calls = 0;
    const subRunner: SubAgentRunner = async () => {
      calls++;
      return { result: "ok" };
    };

    const svc = new CronService(
      getTestDbPath(DB),
      createRealCronRunner(subRunner),
      createRealCronChangeDetector((id) => svc.getStateSnapshot(id)),
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "m",
        schedule: "every 1 minute",
        prompt: "p",
        monitorMode: true,
      });

      // First run: no snapshot yet → changed → runs.
      const r1 = await svc.runJobNow(job.id);
      assert.equal(r1.status, "success");
      assert.equal(calls, 1);

      // Unchanged state → skipped, runner not called.
      const r2 = await svc.runJobNow(job.id);
      assert.equal(r2.status, "skipped");
      assert.equal(r2.usedLlm, false);
      assert.equal(calls, 1);

      // External edit (notepad) → changed → runs again.
      await svc.updateNotepad(job.id, "edited externally");
      const r3 = await svc.runJobNow(job.id);
      assert.equal(r3.status, "success");
      assert.equal(calls, 2);

      // Snapshot persisted in durable storage.
      assert.ok(await svc.getStateSnapshot(job.id));
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("computeCronStateSnapshot ignores run outputs but sees config edits", () => {
    const base = {
      id: "1",
      name: "n",
      schedule: "every 1 minute",
      prompt: "p",
      enabled: true,
      continuity: false,
      monitorMode: true,
      createdAt: "x",
      updatedAt: "x",
    };
    const a = computeCronStateSnapshot({ ...base, lastResult: "old" });
    const b = computeCronStateSnapshot({ ...base, lastResult: "new" });
    assert.equal(a, b);

    const c = computeCronStateSnapshot({ ...base, prompt: "changed" });
    assert.notEqual(a, c);
  });
});
