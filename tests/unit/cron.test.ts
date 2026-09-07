import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CronService,
  type CronRunner,
} from "../../.pi/extensions/cron/CronService.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

const DB = "cron.sqlite";

describe("cron service", () => {
  it("creates a job", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "daily",
        schedule: "every day at 9:00",
        prompt: "summarize",
      });
      assert.ok(job.id);
      assert.ok((await svc.listJobs()).some((j) => j.id === job.id));
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("continuity passes the previous result into the next run", async () => {
    cleanTestDb(DB);
    const prompts: string[] = [];
    const runner: CronRunner = async (_job, p) => {
      prompts.push(p);
      return { result: `run:${prompts.length}`, usedLlm: true };
    };
    const svc = new CronService(getTestDbPath(DB), runner);
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "c",
        schedule: "every 1 minute",
        prompt: "do thing",
        continuity: true,
      });
      await svc.runJobNow(job.id);
      await svc.runJobNow(job.id);
      assert.match(prompts[1], /run:1/);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("monitorMode skips the run when nothing changed", async () => {
    cleanTestDb(DB);
    let runnerCalled = false;
    const runner: CronRunner = async () => {
      runnerCalled = true;
      return { result: "x", usedLlm: true };
    };
    const svc = new CronService(getTestDbPath(DB), runner, async () => false);
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "m",
        schedule: "every 1 minute",
        prompt: "p",
        monitorMode: true,
      });
      const rec = await svc.runJobNow(job.id);
      assert.equal(rec.status, "skipped");
      assert.equal(rec.usedLlm, false);
      assert.equal(runnerCalled, false);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });

  it("notepad persists between runs", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({ name: "n", schedule: "every 1 minute", prompt: "p" });
      await svc.updateNotepad(job.id, "important note");
      assert.equal((await svc.getJob(job.id))?.notepad, "important note");
    } finally {
      await svc.close();
    }

    // Durability across service instances (new connection to the same file).
    const svc2 = new CronService(getTestDbPath(DB));
    await svc2.init();
    try {
      const jobs = await svc2.listJobs();
      assert.equal(jobs.find((j) => j.name === "n")?.notepad, "important note");
    } finally {
      await svc2.close();
      cleanTestDb(DB);
    }
  });

  it("writes run history", async () => {
    cleanTestDb(DB);
    const runner: CronRunner = async () => ({ result: "ok", usedLlm: true });
    const svc = new CronService(getTestDbPath(DB), runner);
    await svc.init();
    try {
      const job = await svc.createJob({ name: "h", schedule: "every 1 minute", prompt: "p" });
      await svc.runJobNow(job.id);
      const runs = await svc.listRuns(job.id);
      assert.ok(runs.length >= 1);
      assert.equal(runs[0].status, "success");
      assert.equal(runs[0].usedLlm, true);
    } finally {
      await svc.close();
      cleanTestDb(DB);
    }
  });
});
