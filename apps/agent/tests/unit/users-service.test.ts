import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  UsersService,
  resolveAclMode,
  resolveOwnerId,
} from "../../src/services/UsersService.js";
import { handleUsersCommand } from "../../src/services/users-command.js";
import type { GrishAiConfig } from "@griha/shared-types";

const tmpDirs: string[] = [];

function makeService(mode: "open" | "closed" = "open"): UsersService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "users-acl-"));
  tmpDirs.push(dir);
  return new UsersService(path.join(dir, "users.json"), { aclMode: mode });
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("UsersService", () => {
  it("empty store + open mode → anyone allowed", async () => {
    const svc = makeService("open");
    assert.equal(await svc.isAllowed("999"), true);
    assert.equal(await svc.isAllowed(123), true);
  });

  it("empty store + closed mode → unknown denied", async () => {
    const svc = makeService("closed");
    assert.equal(await svc.isAllowed("999"), false);
  });

  it("add user → allowed; blocked → not allowed", async () => {
    const svc = makeService("closed");
    await svc.add({ id: "111" });
    assert.equal(await svc.isAllowed("111"), true);
    await svc.setRole("111", "blocked");
    assert.equal(await svc.isAllowed("111"), false);
  });

  it("canManage only for owner/admin (and main-session 'owner')", async () => {
    const svc = makeService("open");
    await svc.add({ id: "u1", role: "user" });
    await svc.add({ id: "a1", role: "admin" });
    await svc.ensureOwner("o1");
    assert.equal(await svc.canManage("o1"), true);
    assert.equal(await svc.canManage("a1"), true);
    assert.equal(await svc.canManage("u1"), false);
    assert.equal(await svc.canManage("nobody"), false);
    assert.equal(await svc.canManage("owner"), true, "main-сессия без Telegram-контекста — оператор");
  });

  it("cannot remove the only owner", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    await assert.rejects(() => svc.remove("o1"), /only owner/);
    assert.equal(await svc.get("o1") === null, false);
  });

  it("cannot demote the only owner to user/blocked", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    await assert.rejects(() => svc.setRole("o1", "user"), /only owner/);
    await assert.rejects(() => svc.setRole("o1", "blocked"), /only owner/);
  });

  it("can demote an owner when another owner remains", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    await svc.ensureOwner("o2");
    const u = await svc.setRole("o1", "user");
    assert.equal(u.role, "user");
  });

  it("cannot assign role owner via add/setRole (v1)", async () => {
    const svc = makeService("open");
    await assert.rejects(() => svc.add({ id: "x", role: "owner" }), /config bootstrap/);
    await svc.add({ id: "x" });
    await assert.rejects(() => svc.setRole("x", "owner"), /config bootstrap/);
  });

  it("persists: new service on the same path sees the user", async () => {
    const svc = makeService("open");
    const dir = path.dirname((svc as unknown as { filePath: string }).filePath);
    await svc.add({ id: "222", username: "@ivan" });
    const svc2 = new UsersService(path.join(dir, "users.json"));
    assert.equal((await svc2.get("222"))?.username, "ivan");
  });

  it("chats restriction: user with chats:[\"1\"] denied in chat \"2\"", async () => {
    const svc = makeService("open");
    await svc.add({ id: "333", chats: ["1"] });
    assert.equal(await svc.isAllowed("333", "1"), true);
    assert.equal(await svc.isAllowed("333", "2"), false);
  });

  it("idempotent add updates username/role and keeps createdAt", async () => {
    const svc = makeService("open");
    const first = await svc.add({ id: "444", username: "@a" });
    const second = await svc.add({ id: "444", username: "@b", role: "admin" });
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.role, "admin");
    assert.equal(second.username, "b");
    assert.equal((await svc.list()).length, 1);
  });

  it("ensureOwner upserts role=owner without wiping other fields", async () => {
    const svc = makeService("open");
    await svc.add({ id: "555", username: "@ivan", role: "user" });
    await svc.ensureOwner("555");
    const u = await svc.get("555");
    assert.equal(u?.role, "owner");
    assert.equal(u?.username, "ivan");
  });

  it("seedLegacyUsers migrates legacy whitelist as role=user (no duplicates)", async () => {
    const svc = makeService("closed");
    await svc.seedLegacyUsers([123, 456]);
    await svc.seedLegacyUsers([123]);
    assert.equal((await svc.list()).length, 2);
    assert.equal(await svc.isAllowed("123"), true);
    assert.equal((await svc.get("123"))?.role, "user");
  });

  it("reload invalidates cache", async () => {
    const svc = makeService("closed");
    await svc.add({ id: "777" });
    const dir = path.dirname((svc as unknown as { filePath: string }).filePath);
    // Внешний пишущий процесс добавил запись напрямую в файл.
    fs.writeFileSync(
      path.join(dir, "users.json"),
      JSON.stringify({
        version: 1,
        users: [{ id: "888", role: "admin", createdAt: "t", updatedAt: "t" }],
      }),
      "utf8",
    );
    assert.equal(await svc.isAllowed("888"), false, "cache ещё старый");
    await svc.reload();
    assert.equal(await svc.isAllowed("888"), true);
  });

  it("corrupted store file is treated as empty, not a crash", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "users-acl-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "users.json"), "{ not json", "utf8");
    const svc = new UsersService(path.join(dir, "users.json"), { aclMode: "closed" });
    assert.deepEqual(await svc.list(), []);
    assert.equal(await svc.isAllowed("1"), false);
  });

  it("resolveAclMode: explicit config wins; closed when owner/whitelist set; open otherwise", () => {
    const base = { version: 1, provider: "deepseek", model: "m", setupCompletedAt: "t" } as GrishAiConfig;
    assert.equal(resolveAclMode({ ...base, aclMode: "open" }), "open");
    assert.equal(resolveAclMode({ ...base, ownerUserId: "1" }), "closed");
    assert.equal(resolveAclMode({ ...base, telegram: { botToken: "t", allowedUserIds: [1] } }), "closed");
    assert.equal(resolveAclMode(base), "open");
    assert.equal(resolveOwnerId({ ...base, ownerUserId: " 42 " }), "42");
  });
});

describe("handleUsersCommand", () => {
  it("rejects non-managers", async () => {
    const svc = makeService("closed");
    await svc.ensureOwner("o1");
    const reply = await handleUsersCommand(svc, "list", { userId: "random" });
    assert.equal(reply, "Недостаточно прав. Нужна роль owner или admin.");
  });

  it("adds a user via /users add and lists them", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    const add = await handleUsersCommand(svc, "add 111222333", { userId: "o1" });
    assert.equal(add, "OK: user 111222333 role=user");
    const list = await handleUsersCommand(svc, "", { userId: "o1" });
    assert.ok(list.includes("Users (2):"));
    assert.ok(list.includes("111222333 [user]"));
    assert.ok(list.includes("o1 [owner]"));
  });

  it("rejects owner role and unknown role in /users add", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    assert.ok((await handleUsersCommand(svc, "add 1 owner", { userId: "o1" })).includes("Неизвестная роль"));
    assert.ok((await handleUsersCommand(svc, "add 1 mega", { userId: "o1" })).includes("Неизвестная роль"));
  });

  it("sets role and removes via commands", async () => {
    const svc = makeService("open");
    await svc.ensureOwner("o1");
    await handleUsersCommand(svc, "add 42", { userId: "o1" });
    assert.equal(await handleUsersCommand(svc, "role 42 blocked", { userId: "o1" }), "OK: user 42 role=blocked");
    assert.equal(await svc.isAllowed("42"), false);
    assert.equal(await handleUsersCommand(svc, "remove 42", { userId: "o1" }), "OK: user 42 removed");
    assert.equal(await handleUsersCommand(svc, "remove 42", { userId: "o1" }), "User 42 not found.");
  });
});
