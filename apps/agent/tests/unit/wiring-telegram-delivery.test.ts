import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CronService,
  type CronDelivery,
  type CronRunner,
} from "../../.pi/extensions/cron/CronService.js";
import {
  deliverCronResult,
  setCronDeliveryNotifier,
} from "../../.pi/extensions/cron/delivery-wiring.js";
import { cleanTestDb, getTestDbPath } from "../setup.js";

/**
 * W10 (матрица M4) — доставка Cron → Telegram за флагом (P02).
 * execution ≠ delivery: статус доставки не влияет на status задачи.
 * Flag off → доставки нет (1:1). Правка Telegram-слоя — только регистрация
 * notifier (тестируется здесь на уровне transport-контракта).
 */

const DB = "wiring-tg-delivery.sqlite";
const ON = { GRIHA_AGENT_RUNTIME: "1" };

const runner: CronRunner = async () => ({ result: "готово", usedLlm: true });

function makeService(delivery?: CronDelivery, env: NodeJS.ProcessEnv = ON) {
  return new CronService(getTestDbPath(DB), runner, undefined, undefined, undefined, env, delivery);
}

describe("deliverCronResult (P02)", () => {
  it("без notifier → skipped", async () => {
    setCronDeliveryNotifier(null);
    const res = await deliverCronResult({ chatId: "1" }, "hi");
    assert.equal(res.status, "skipped");
  });

  it("успех с первого раза → ok, attempts=1", async () => {
    setCronDeliveryNotifier(async () => {});
    const res = await deliverCronResult({ chatId: "1" }, "hi");
    assert.equal(res.status, "ok");
    assert.equal(res.attempts, 1);
  });

  it("временная ошибка → ретрай до успеха (P02: maxRetries=2)", async () => {
    let calls = 0;
    setCronDeliveryNotifier(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error("ETIMEDOUT") as Error & { status?: number };
        err.status = 500;
        throw err;
      }
    });
    const res = await deliverCronResult({ chatId: "1" }, "hi", {
      maxRetries: 2,
      retryDelayMs: 1,
    });
    assert.equal(res.status, "ok");
    assert.equal(calls, 3);
  });

  it("permanent ошибка → permanent_failure без ретраев", async () => {
    let calls = 0;
    setCronDeliveryNotifier(async () => {
      calls++;
      const err = new Error("bot was blocked") as Error & { status?: number };
      err.status = 403;
      throw err;
    });
    const res = await deliverCronResult({ chatId: "1" }, "hi", {
      maxRetries: 2,
      retryDelayMs: 1,
    });
    assert.equal(res.status, "permanent_failure");
    assert.equal(calls, 1);
  });
});

describe("CronService delivery (W10/M4)", () => {
  it("flag off + chatId + delivery → доставка не вызывается, delivery_status null", async () => {
    cleanTestDb(DB);
    let calls = 0;
    const svc = makeService(async () => {
      calls++;
      return { status: "ok" };
    }, {});
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "d",
        schedule: "every 1 minute",
        prompt: "a",
      });
      await svc.updateJob(job.id, { chatId: "123" });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.deliveryStatus, undefined);
      assert.equal(calls, 0);
      const stored = (await svc.listRuns(job.id))[0];
      assert.equal(stored.deliveryStatus, undefined);
    } finally {
      await svc.close();
    }
  });

  it("flag on, без chatId → доставки нет", async () => {
    cleanTestDb(DB);
    let calls = 0;
    const svc = makeService(async () => {
      calls++;
      return { status: "ok" };
    });
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "d",
        schedule: "every 1 minute",
        prompt: "a",
      });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "success");
      assert.equal(run.deliveryStatus, undefined);
      assert.equal(calls, 0);
    } finally {
      await svc.close();
    }
  });

  it("flag on + chatId + ok → deliveryStatus ok (execution ≠ delivery)", async () => {
    cleanTestDb(DB);
    const delivered: Array<{ chatId: string; text: string }> = [];
    const svc = makeService(async (target, text) => {
      delivered.push({ chatId: target.chatId, text });
      return { status: "ok" };
    });
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "d",
        schedule: "every 1 minute",
        prompt: "a",
      });
      await svc.updateJob(job.id, { chatId: "123", threadId: "9" });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "success");
      assert.equal(run.deliveryStatus, "ok");
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].chatId, "123");
      assert.equal(delivered[0].text, "готово");
      const stored = (await svc.listRuns(job.id))[0];
      assert.equal(stored.deliveryStatus, "ok");
    } finally {
      await svc.close();
    }
  });

  it("flag on + permanent_failure → status success, deliveryStatus permanent_failure", async () => {
    cleanTestDb(DB);
    const svc = makeService(async () => ({ status: "permanent_failure" }));
    await svc.init();
    try {
      const job = await svc.createJob({
        name: "d",
        schedule: "every 1 minute",
        prompt: "a",
      });
      await svc.updateJob(job.id, { chatId: "123" });
      const run = await svc.runJobNow(job.id);
      assert.equal(run.status, "success");
      assert.equal(run.deliveryStatus, "permanent_failure");
      assert.equal(
        (await svc.listRuns(job.id))[0].deliveryStatus,
        "permanent_failure",
      );
    } finally {
      await svc.close();
    }
  });
});
