import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startTypingHeartbeat } from "../../.pi/extensions/telegram-bot/typing-heartbeat.js";

interface Captured {
  chatId: number;
  action: string;
  messageThreadId?: number;
}

describe("startTypingHeartbeat", () => {
  it("первый sendChatAction — сразу, с typing", async () => {
    const calls: Captured[] = [];
    const hb = startTypingHeartbeat(42, undefined, {
      sendChatAction: async (chatId, action, extra) => {
        calls.push({ chatId, action, messageThreadId: extra?.messageThreadId });
      },
      intervalMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 5));
    await hb.stop();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].chatId, 42);
    assert.equal(calls[0].action, "typing");
  });

  it("пульсирует каждые intervalMs (минимум 2 вызова до stop)", async () => {
    const calls: number[] = [];
    const hb = startTypingHeartbeat(42, undefined, {
      sendChatAction: async () => {
        calls.push(1);
      },
      intervalMs: 10,
    });
    await new Promise((r) => setTimeout(r, 35));
    await hb.stop();
    assert.ok(calls.length >= 2, `ожидалось >=2 пульсов, получено ${calls.length}`);
  });

  it("после stop новых вызовов нет", async () => {
    const calls: number[] = [];
    const hb = startTypingHeartbeat(42, undefined, {
      sendChatAction: async () => {
        calls.push(1);
      },
      intervalMs: 10,
    });
    await new Promise((r) => setTimeout(r, 15));
    await hb.stop();
    const afterStop = calls.length;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls.length, afterStop, "после stop пульсов нет");
  });

  it("sendChatAction throws — loop не падает, stop resolve", async () => {
    const hb = startTypingHeartbeat(42, undefined, {
      sendChatAction: async () => {
        throw new Error("bot kicked");
      },
      intervalMs: 10,
    });
    await new Promise((r) => setTimeout(r, 25));
    await hb.stop(); // не должен бросить/зависнуть
    assert.ok(true);
  });

  it("messageThreadId прокидывается, если threadId задан", async () => {
    const calls: Captured[] = [];
    const hb = startTypingHeartbeat(-100, "15", {
      sendChatAction: async (chatId, action, extra) => {
        calls.push({ chatId, action, messageThreadId: extra?.messageThreadId });
      },
      intervalMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 5));
    await hb.stop();
    assert.equal(calls[0].messageThreadId, 15, "форум: та же тема");
  });
});
