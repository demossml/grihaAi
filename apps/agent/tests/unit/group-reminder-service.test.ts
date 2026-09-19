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
});
