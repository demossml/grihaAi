import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GroupParticipantService } from "../../src/services/secretary/participants.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function make(): GroupParticipantService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "participants-"));
  tmpDirs.push(dir);
  const svc = new GroupParticipantService(path.join(dir, "p.sqlite"));
  svc.init();
  return svc;
}

test("upsert: новый участник → member", () => {
  const svc = make();
  const p = svc.upsert({ chatId: "-100", userId: "1", displayName: "Иван" });
  assert.equal(p.role, "member");
  assert.equal(p.displayName, "Иван");
});

test("upsert: сохраняет существующую роль (не понижает), обновляет имя", () => {
  const svc = make();
  svc.upsert({ chatId: "-100", userId: "1", displayName: "Иван", role: "owner" });
  svc.upsert({ chatId: "-100", userId: "1", displayName: "Иван2" });
  const p = svc.get("-100", "1");
  assert.equal(p!.role, "owner");
  assert.equal(p!.displayName, "Иван2");
});

test("listByChat: только участники заданного чата", () => {
  const svc = make();
  svc.upsert({ chatId: "-100", userId: "1" });
  svc.upsert({ chatId: "-100", userId: "2" });
  svc.upsert({ chatId: "-200", userId: "3" });
  assert.equal(svc.listByChat("-100").length, 2);
  assert.equal(svc.listByChat("-200").length, 1);
});

test("setRole: deny без canManage", () => {
  const svc = make();
  svc.upsert({ chatId: "-100", userId: "1" });
  assert.throws(() => svc.setRole("-100", "1", "finance", { canManage: false }), /canManage/);
});

test("setRole: canManage назначает роль", () => {
  const svc = make();
  svc.upsert({ chatId: "-100", userId: "1" });
  const p = svc.setRole("-100", "1", "finance", { canManage: true });
  assert.equal(p.role, "finance");
});

test("setRole: owner запрещён через API", () => {
  const svc = make();
  svc.upsert({ chatId: "-100", userId: "1" });
  assert.throws(() => svc.setRole("-100", "1", "owner", { canManage: true }), /owner/);
});
