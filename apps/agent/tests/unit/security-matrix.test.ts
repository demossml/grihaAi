/**
 * PROMPT 08 — security matrix: правила меняет только creator/admin/canManage,
 * fail closed при API error, sender_chat ≠ user authorization, изоляция чатов.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeGuardedRulesHandler } from "../../.pi/extensions/telegram-bot/rules-auth.js";
import { TelegramBridge } from "../../.pi/extensions/telegram-bot/TelegramBridge.js";
import { ChatPolicyStore } from "../../.pi/extensions/user-rules/chat-policy.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeHandler(opts: {
  status?: string;
  apiError?: boolean;
  canManage?: boolean;
  chatType?: string;
}) {
  const calls: string[] = [];
  const handler = makeGuardedRulesHandler({
    run: (args, ctx) => {
      calls.push(`${ctx.chatId}:${args}`);
      return "OK";
    },
    getChatMember: async () => {
      if (opts.apiError) throw new Error("API down");
      return { status: opts.status ?? "member" };
    },
    users: { canManage: async () => opts.canManage === true },
  });
  return { handler, calls };
}

describe("rules mutation authorization (matrix)", () => {
  it("creator → разрешено; administrator → разрешено", async () => {
    for (const status of ["creator", "administrator"]) {
      const { handler, calls } = makeHandler({ status });
      const reply = await handler("add отвечай кратко", {
        chatId: "-100",
        userId: "42",
        chatType: "supergroup",
      });
      assert.equal(reply, "OK", `status=${status}`);
      assert.equal(calls.length, 1);
    }
  });

  it("member / restricted / unknown → deny", async () => {
    for (const status of ["member", "restricted", "left", "kicked", "unknown"]) {
      const { handler, calls } = makeHandler({ status });
      const reply = await handler("add правило", {
        chatId: "-100",
        userId: "42",
        chatType: "group",
      });
      assert.equal(reply, "Нужны права администратора группы.", `status=${status}`);
      assert.equal(calls.length, 0, "мутация не дошла до store");
    }
  });

  it("API error → deny (fail closed, без catch{return true})", async () => {
    const { handler, calls } = makeHandler({ apiError: true });
    const reply = await handler("delete r1", {
      chatId: "-100",
      userId: "42",
      chatType: "supergroup",
    });
    assert.equal(reply, "Не удалось проверить права, попробуйте позже.");
    assert.equal(calls.length, 0);
  });

  it("не-admin, но owner/admin ACL (canManage) → разрешено", async () => {
    const { handler } = makeHandler({ status: "member", canManage: true });
    const reply = await handler("off r2", {
      chatId: "-100",
      userId: "570",
      chatType: "supergroup",
    });
    assert.equal(reply, "OK");
  });

  it("DM (private) → правила своего чата без admin-проверки", async () => {
    const { handler, calls } = makeHandler({ status: "member" });
    const reply = await handler("add стиль краткий", {
      chatId: "999",
      userId: "42",
      chatType: "private",
    });
    assert.equal(reply, "OK");
    assert.equal(calls.length, 1);
  });

  it("list (read) → доступен без admin-проверки", async () => {
    const { handler, calls } = makeHandler({ status: "member" });
    const reply = await handler("list", { chatId: "-100", userId: "42", chatType: "group" });
    assert.equal(reply, "OK");
    assert.equal(calls.length, 1);
  });

  it("нет getChatMember → deny (нет способа проверить)", async () => {
    const handler = makeGuardedRulesHandler({
      run: () => "OK",
      users: { canManage: async () => false },
    });
    const reply = await handler("add x", { chatId: "-100", userId: "42", chatType: "group" });
    assert.equal(reply, "Нет возможности проверить права.");
  });
});

describe("sender_chat ≠ user authorization", () => {
  it("channel_post от sender_chat, чей id даже в allowedUserIds → агент не вызывается", async () => {
    let agentCalls = 0;
    const bridge = new TelegramBridge(
      [-300], // id канала «в whitelist» — но это НЕ user
      async () => {
        agentCalls++;
        return { text: "x" };
      },
      async () => undefined,
      {
        prefilter: (input) => ({
          process: true,
          suppressReply: false,
          archive: input.isChannel === true,
        }),
      },
    );
    const res = await bridge.handleUpdate({
      updateId: 1,
      updateKind: "channel_post",
      message: {
        senderChat: { id: -300, title: "Канал" },
        chat: { id: -300, type: "channel" },
        messageId: 5,
        text: "пост",
      },
    });
    assert.equal(res.reason, "channel-no-user", "sender_chat не даёт agent-прав");
    assert.equal(agentCalls, 0);
  });
});

describe("chat isolation", () => {
  it("policy чата A не влияет на чат B (раздельные записи)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iso-"));
    tmpDirs.push(dir);
    const store = new ChatPolicyStore(path.join(dir, "chat-policy.sqlite"));
    store.record("-100", {
      response: { mode: "always" },
      archive: { text: true, photo: true, document: true, voice: true },
      processing: { photoOcr: true, documentOcr: true, voiceStt: true },
      agent: { enabled: true },
    }, { source: "preset:listener", actorId: "570" });
    store.record("-200", {
      response: { mode: "always" },
      archive: { text: false, photo: false, document: false, voice: false },
      processing: { photoOcr: false, documentOcr: false, voiceStt: false },
      agent: { enabled: true },
    }, { source: "preset:team", actorId: "570" });

    const a = store.get("-100")!;
    const b = store.get("-200")!;
    assert.equal(a.policy.archive.text, true);
    assert.equal(b.policy.archive.text, false);
    assert.equal(a.version, 1);
    assert.equal(b.version, 1, "версии считаются per-chat");
    store.close();
  });
});
