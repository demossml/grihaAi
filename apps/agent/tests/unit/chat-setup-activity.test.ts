/**
 * P0-2 — touchLastSeen (throttle 60с) + updateChatMeta (title по изменению).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-setup-activity-"));
  tmpDirs.push(dir);
  const rules = { replaceChatManagedRules() {}, getHardRules: () => [], getSoftRules: () => [] };
  const setup = new ChatSetupService(
    path.join(dir, "chat-setup.json"),
    rules as unknown as UserRulesService,
  );
  return { setup };
}

describe("touchLastSeen (P0-2)", () => {
  it("обновляет lastSeenAt ISO", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");
    const t = new Date("2026-09-10T10:00:00.000Z");
    await setup.touchLastSeen("-100", t);
    assert.equal((await setup.get("-100"))?.lastSeenAt, t.toISOString());
  });

  it("throttle: два вызова <60с → lastSeenAt не меняется", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatType: "group", addedByUserId: "1" });
    await setup.markCompleted("-100", "listener");

    const t0 = new Date("2026-09-10T10:00:00.000Z");
    await setup.touchLastSeen("-100", t0);
    const first = (await setup.get("-100"))?.lastSeenAt;

    // +30s — в пределах throttle, не пишем.
    await setup.touchLastSeen("-100", new Date(t0.getTime() + 30_000));
    assert.equal((await setup.get("-100"))?.lastSeenAt, first, "throttled — без записи");

    // +61s — за пределами throttle, пишем.
    const t2 = new Date(t0.getTime() + 61_000);
    await setup.touchLastSeen("-100", t2);
    assert.equal((await setup.get("-100"))?.lastSeenAt, t2.toISOString(), "после throttle — обновлено");
  });
});

describe("updateChatMeta (P0-2)", () => {
  it("обновляет title при изменении", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    await setup.updateChatMeta("-100", { title: "Новое" });
    assert.equal((await setup.get("-100"))?.chatTitle, "Новое");
  });

  it("не пишет при том же title", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    await setup.updateChatMeta("-100", { title: "Старое" });
    assert.equal((await setup.get("-100"))?.chatTitle, "Старое", "title не менялся");
  });

  it("updateChatMeta без title → no-op", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    await setup.updateChatMeta("-100", {});
    assert.equal((await setup.get("-100"))?.chatTitle, "Старое");
  });

  it("trim: title с пробелами обрезается", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    await setup.updateChatMeta("-100", { title: "  Ремонт  " });
    assert.equal((await setup.get("-100"))?.chatTitle, "Ремонт");
    assert.equal(setup.getChatTitleSync("-100"), "Ремонт");
  });

  it("whitespace-only title → no-op", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    await setup.updateChatMeta("-100", { title: "   " });
    assert.equal((await setup.get("-100"))?.chatTitle, "Старое");
  });

  it("неизвестный chatId → не создаёт запись (list length тот же)", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    const before = (await setup.list()).length;
    await setup.updateChatMeta("-999", { title: "Новый чат" });
    const after = (await setup.list()).length;
    assert.equal(before, after);
    assert.equal(await setup.get("-999"), null);
  });

  it("обновляет updatedAt при изменении title", async () => {
    const { setup } = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Старое", chatType: "group", addedByUserId: "1" });
    const before = (await setup.get("-100"))?.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await setup.updateChatMeta("-100", { title: "Новое" });
    const after = (await setup.get("-100"))?.updatedAt;
    assert.notEqual(after, before, "updatedAt должен обновиться");
  });
});
