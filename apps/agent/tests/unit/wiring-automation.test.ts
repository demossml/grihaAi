import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CronService,
  type CronRunner,
} from "../../.pi/extensions/cron/CronService.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

/**
 * W7 (матрица J2/J4) — update/remove/pause/resume + script-jobs в CronService.
 * Flag off = старое поведение 1:1 (script игнорируется). Flag on = script-job
 * исполняется через executor без LLM; update/remove/pause/resume — аддитивные
 * методы (§21 AutomationEngine).
 */

const DB = "wiring-automation.sqlite";

const ON = { HERMES_AGENT_RUNTIME: "1" };

function makeRunner(): CronRunner & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (_job, prompt) => {
    calls.push(prompt);
    return { result: `llm:${prompt}`, usedLlm: true };
  }) as CronRunner & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("wiring: automation в CronService (W7/J2/J4)", () => {
  it("flag off + script: выполняется как обычная LLM-джоба (script игнорируется)", async () => {
    cleanTestDb(DB);
    const runner = makeRunner();
    const svc = new CronService(getTestDbPath(DB), runner);
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "s",
        schedule: "every 1 minute",
        prompt: "do",
        script: "echo hi",
      });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "success");
      assert.equal(run.usedLlm, true);
      assert.equal(runner.calls.length, 1);
    } finally {
      await svc.close();
    }
  });

  it("flag on + script job: executor без LLM, usedLlm=false", async () => {
    cleanTestDb(DB);
    const svc = new CronService(
      getTestDbPath(DB),
      undefined,
      undefined,
      undefined,
      async (spec) => ({
        exitCode: 0,
        stdout: spec.command,
        stderr: "",
        durationMs: 7,
      }),
      ON,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "script-job",
        schedule: "every 5 minutes",
        prompt: "unused",
        script: "echo hi",
        scriptArgs: ["a"],
      });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "success");
      assert.equal(run.usedLlm, false);
      assert.match(run.result ?? "", /exitCode: 0/);
      assert.match(run.result ?? "", /stdout:\necho hi/);
    } finally {
      await svc.close();
    }
  });

  it("flag on + script job без executor: failed с причиной", async () => {
    cleanTestDb(DB);
    const svc = new CronService(
      getTestDbPath(DB),
      undefined,
      undefined,
      undefined,
      undefined,
      ON,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "no-exec",
        schedule: "every 5 minutes",
        prompt: "unused",
        script: "echo hi",
      });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "failed");
      assert.match(run.result ?? "", /no script executor configured/);
    } finally {
      await svc.close();
    }
  });

  it("flag on + script job с пустой командой: failed с валидацией", async () => {
    cleanTestDb(DB);
    const svc = new CronService(
      getTestDbPath(DB),
      undefined,
      undefined,
      undefined,
      undefined,
      ON,
    );
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "bad-script",
        schedule: "every 5 minutes",
        prompt: "unused",
        script: "   ",
      });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "failed");
      assert.match(run.result ?? "", /script validation failed/);
    } finally {
      await svc.close();
    }
  });

  it("updateJob: поля обновляются, unknown id → null", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "u",
        schedule: "every 1 minute",
        prompt: "a",
      });
      const updated = await svc.updateJob(job.id, {
        schedule: "every 10 minutes",
        prompt: "b",
        enabled: false,
      });
      assert.equal(updated?.schedule, "every 10 minutes");
      assert.equal(updated?.prompt, "b");
      assert.equal(updated?.enabled, false);
      assert.equal((await svc.getJob(job.id))?.prompt, "b");
      assert.equal(await svc.updateJob("nope", { prompt: "x" }), null);
    } finally {
      await svc.close();
    }
  });

  it("removeJob: удаляет джобу и прогоны; повторно → false", async () => {
    cleanTestDb(DB);
    const runner = makeRunner();
    const svc = new CronService(getTestDbPath(DB), runner);
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "r",
        schedule: "every 1 minute",
        prompt: "a",
      });
      await svc.runJobNow(job.id);
      assert.equal(await svc.removeJob(job.id), true);
      assert.equal(await svc.getJob(job.id), null);
      assert.equal((await svc.listRuns(job.id)).length, 0);
      assert.equal(await svc.removeJob(job.id), false);
    } finally {
      await svc.close();
    }
  });

  it("pauseJob/resumeJob: тогл enabled (§21)", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "p",
        schedule: "every 1 minute",
        prompt: "a",
      });
      assert.equal(job.enabled, true);
      const paused = await svc.pauseJob(job.id);
      assert.equal(paused?.enabled, false);
      const resumed = await svc.resumeJob(job.id);
      assert.equal(resumed?.enabled, true);
    } finally {
      await svc.close();
    }
  });

  it("scriptArgs сохраняются и читаются обратно", async () => {
    cleanTestDb(DB);
    const svc = new CronService(getTestDbPath(DB));
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "args",
        schedule: "every 1 minute",
        prompt: "a",
        script: "ls",
        scriptArgs: ["-la", "/tmp"],
      });
      const loaded = await svc.getJob(job.id);
      assert.deepEqual(loaded?.scriptArgs, ["-la", "/tmp"]);
      const updated = await svc.updateJob(job.id, { scriptArgs: [] });
      assert.equal(updated?.scriptArgs, undefined);
    } finally {
      await svc.close();
    }
  });
});
