/**
 * S7 — ACL matrix: membership (isAllowed) ≠ management (canManage).
 * Реальные UsersService + assertCanReadChat (не моки) — полный цикл доступа.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsersService } from "../../src/services/UsersService.js";
import { assertCanReadChat } from "../../src/services/documents/groupHistoryTools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeUsers(mode: "open" | "closed" = "closed"): UsersService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acl-matrix-"));
  tmpDirs.push(dir);
  return new UsersService(path.join(dir, "users.json"), { aclMode: mode });
}

/** Реальные ACL-deps для assertCanReadChat из UsersService. */
function aclDeps(users: UsersService) {
  return {
    isConfiguredSync: () => true,
    canManage: (u: string | number) => users.canManage(u),
    isAllowed: (u: string, c: string) => users.isAllowed(u, c),
    listConfiguredChatIds: async () => ["-100", "-200"],
  };
}

describe("ACL matrix: membership ≠ management (S7)", () => {
  it("member (isAllowed) читает свою группу; чужую — нет (изоляция A vs B)", async () => {
    const users = makeUsers("closed");
    await users.add({ id: "42", chats: ["-100"] }); // член группы A, не группы B
    const deps = aclDeps(users);

    assert.equal(await assertCanReadChat("42", "-100", deps), true, "своя группа");
    assert.equal(await assertCanReadChat("42", "-200", deps), false, "чужая группа");
  });

  it("случайный userId (не в ACL, closed) → deny", async () => {
    const users = makeUsers("closed");
    assert.equal(await assertCanReadChat("999", "-100", aclDeps(users)), false);
  });

  it("owner/admin (canManage) читает ЛЮБУЮ configured группу без isAllowed", async () => {
    const users = makeUsers("closed");
    await users.ensureOwner("1");
    const deps = aclDeps(users);
    assert.equal(await assertCanReadChat("1", "-100", deps), true);
    assert.equal(await assertCanReadChat("1", "-200", deps), true);
  });

  it("member (роль user) НЕ управляет: canManage=false", async () => {
    const users = makeUsers("closed");
    await users.add({ id: "42", role: "user" });
    assert.equal(await users.canManage("42"), false, "membership ≠ management");
  });

  it("archived чат недоступен даже member'у (не configured)", async () => {
    const users = makeUsers("closed");
    await users.add({ id: "42", chats: ["-100"] });
    const deps = { ...aclDeps(users), isConfiguredSync: (c: string) => c !== "-100" };
    assert.equal(await assertCanReadChat("42", "-100", deps), false, "archived → not configured");
  });
});
