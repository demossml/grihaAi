/**
 * S12 — GroupReminderService: create, low-confidence → needs_confirmation,
 * archived-чат пропускает fire, restart load из файла.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GroupReminderService,
  LOW_CONFIDENCE_THRESHOLD,
  type FireReminderDeps,
} from "../../src/services/reminders/GroupReminderService.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeService(): { svc: GroupReminderService; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-reminders-"));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, "reminders.sqlite");
  const svc = new GroupReminderService(dbPath);
  svc.init();
  return { svc, dbPath };
}

const pastDue = new Date(Date.now() - 60_000).toISOString();

describe("GroupReminderService (S12)", () => {
  it("create: high confidence → pending; low → needs_confirmation", () => {
    const { svc } = makeService();
    const high = svc.add({ chatId: "-100", dueAt: pastDue, text: "напомни", confidence: 1 });
    const low = svc.add({ chatId: "-100", dueAt: pastDue, text: "не уверен", confidence: 0.2 });
    assert.equal(high.status, "pending");
    assert.equal(low.status, "needs_confirmation");
    assert.equal(low.confidence < LOW_CONFIDENCE_THRESHOLD, true);
  });

  it("fireDue: archived-чат пропускается (send не вызывается)", async () => {
    const { svc } = makeService();
    svc.add({ chatId: "-100", threadId: "15", dueAt: pastDue, text: "напомни" });

    const sent: string[] = [];
    const deps: FireReminderDeps = {
      isChatActive: () => false, // archived/pending
      send: async (_chatId, text, _threadId) => {
        sent.push(text);
      },
    };
    const res = await svc.fireDue(new Date(), deps);
    assert.equal(res.skipped, 1);
    assert.equal(res.fired, 0);
    assert.equal(sent.length, 0, "архивированный чат не получает напоминание");
  });

  it("fireDue: active-чат шлёт напоминание с threadId и помечает fired", async () => {
    const { svc } = makeService();
    const r = svc.add({ chatId: "-100", threadId: "15", dueAt: pastDue, text: "напомни" });

    const sent: Array<{ chatId: string; threadId?: string }> = [];
    const deps: FireReminderDeps = {
      isChatActive: () => true,
      send: async (chatId, _text, threadId) => {
        sent.push({ chatId, threadId });
      },
    };
    const res = await svc.fireDue(new Date(), deps);
    assert.equal(res.fired, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, "-100");
    assert.equal(sent[0].threadId, "15");
    assert.equal(svc.get(r.id)?.status, "fired");
  });

  it("restart load: новый инстанс на том же файле видит напоминание", () => {
    const { svc, dbPath } = makeService();
    svc.add({ chatId: "-100", dueAt: pastDue, text: "переживи рестарт" });
    svc.close();

    const svc2 = new GroupReminderService(dbPath);
    svc2.init();
    const due = svc2.listDue(new Date());
    assert.equal(due.length, 1);
    assert.equal(due[0].text, "переживи рестарт");
    svc2.close();
  });

  it("needs_confirmation не попадает в listDue (без авто-спама)", () => {
    const { svc } = makeService();
    svc.add({ chatId: "-100", dueAt: pastDue, text: "не уверен", confidence: 0.1 });
    const due = svc.listDue(new Date());
    assert.equal(due.length, 0, "low-confidence не авто-рассылается");
  });

  it("P0-3: send fail → НЕ fired (остаётся pending для ретрая)", async () => {
    const { svc } = makeService();
    svc.add({ chatId: "-100", dueAt: pastDue, text: "напомни" });
    const deps: FireReminderDeps = {
      isChatActive: () => true,
      send: async () => {
        throw new Error("send down");
      },
    };
    await assert.rejects(() => svc.fireDue(new Date(), deps), /send down/);
    const due = svc.listDue(new Date());
    assert.equal(due.length, 1, "не помечен fired");
    assert.equal(due[0].status, "pending", "остаётся pending — ретрай в след. тике");
  });

  it("P0-4: list(chatId, status) фильтрует по чату и статусу", () => {
    const { svc } = makeService();
    svc.add({ chatId: "-100", dueAt: pastDue, text: "a" });
    svc.add({ chatId: "-100", dueAt: pastDue, text: "b", confidence: 0.1 }); // needs_confirmation
    svc.add({ chatId: "-200", dueAt: pastDue, text: "c" });
    assert.equal(svc.list("-100").length, 2, "только чат -100");
    assert.equal(svc.list("-100", "needs_confirmation").length, 1);
    assert.equal(svc.list("-100", "pending").length, 1);
  });

  it("P0-4: confirm needs_confirmation → pending (появляется в listDue)", () => {
    const { svc } = makeService();
    const r = svc.add({ chatId: "-100", dueAt: pastDue, text: "подтверди", confidence: 0.1 });
    assert.equal(r.status, "needs_confirmation");
    const confirmed = svc.confirm(r.id);
    assert.equal(confirmed?.status, "pending");
    assert.equal(svc.listDue(new Date()).length, 1, "после confirm — в listDue");
  });

  it("P0-4: confirm не-needs_confirmation → undefined", () => {
    const { svc } = makeService();
    const r = svc.add({ chatId: "-100", dueAt: pastDue, text: "уже pending" });
    assert.equal(r.status, "pending");
    assert.equal(svc.confirm(r.id), undefined);
  });

  it("R6: overdue старше 24ч → expired (не шлём)", async () => {
    const { svc } = makeService();
    const oldDue = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    svc.add({ chatId: "-100", dueAt: oldDue, text: "старое" });

    const sent: string[] = [];
    const deps: FireReminderDeps = {
      isChatActive: () => true,
      send: async (_c, text) => {
        sent.push(text);
      },
    };
    const res = await svc.fireDue(new Date(), deps);
    assert.equal(res.fired, 0);
    assert.equal(res.expired, 1);
    assert.equal(sent.length, 0, "overdue старше 24ч не рассылается");
    assert.equal(svc.get(svc.list("-100")[0].id)?.status ?? "?", "expired");
  });
});
