import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRule } from "@griha/shared-types";
import { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import {
  AUTO_REMINDERS_KEY,
  isAutoRemindersEnabledFromRules,
  setAutoReminders,
} from "../../.pi/extensions/user-rules/auto-reminders.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const rule = (value: boolean): UserRule => ({
  id: "r-auto",
  scope: "chat",
  chatId: "-100",
  text: `${AUTO_REMINDERS_KEY} = ${String(value)}`,
  kind: "soft",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
  key: AUTO_REMINDERS_KEY,
  value,
});

test("auto_reminders: default ON если не задан", () => {
  assert.equal(isAutoRemindersEnabledFromRules([]), true);
});

test("auto_reminders: false rule → OFF", () => {
  assert.equal(isAutoRemindersEnabledFromRules([rule(false)]), false);
});

test("auto_reminders: true rule → ON", () => {
  assert.equal(isAutoRemindersEnabledFromRules([rule(true)]), true);
});

test("setAutoReminders записывает structured rule (readback OFF/ON)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-reminders-"));
  tmpDirs.push(dir);
  const svc = new UserRulesService(path.join(dir, "rules.sqlite"));
  svc.init();

  setAutoReminders("-100", false, svc);
  const off = svc.getSoftRules("-100");
  assert.equal(isAutoRemindersEnabledFromRules(off), false);

  setAutoReminders("-100", true, svc);
  const on = svc.getSoftRules("-100");
  assert.equal(isAutoRemindersEnabledFromRules(on), true);
  // повторный set не плодит дубли (upsert по ключу)
  assert.equal(on.filter((r) => r.key === AUTO_REMINDERS_KEY).length, 1);

  svc.close();
});
