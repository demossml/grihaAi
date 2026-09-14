/**
 * M4 (post-wiring, отдельный шаг) — thread_id-доставка Cron → Telegram.
 * DeliveryTarget.threadId (J5 cron_jobs.thread_id) доезжает до sendMessage
 * как message_thread_id (форум-топики); без threadId — 1:1 (пустой extra).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deliverCronResult,
  notifierArgs,
  setCronDeliveryNotifier,
} from "../../.pi/extensions/cron/delivery-wiring.js";
import { sendNotifyExtra } from "../../.pi/extensions/telegram-bot/TelegramBotController.js";

describe("thread_id-доставка (M4)", () => {
  it("notifierArgs: chatId + threadId из DeliveryTarget", () => {
    assert.deepEqual(notifierArgs({ chatId: "42", threadId: "7" }), {
      chatId: 42,
      messageThreadId: 7,
    });
  });

  it("notifierArgs: без threadId → только chatId (1:1)", () => {
    assert.deepEqual(notifierArgs({ chatId: "42" }), { chatId: 42 });
  });

  it("sendNotifyExtra: thread → { messageThreadId }, без thread → {}", () => {
    assert.deepEqual(sendNotifyExtra(7), { messageThreadId: 7 });
    assert.deepEqual(sendNotifyExtra(undefined), {});
  });

  it("deliverCronResult пробрасывает threadId в notifier", async () => {
    const captured: Array<{ target: { chatId: string; threadId?: string }; text: string }> = [];
    setCronDeliveryNotifier(async (target, text) => {
      captured.push({ target: { ...target }, text });
    });
    const res = await deliverCronResult({ chatId: "42", threadId: "7" }, "отчёт");
    assert.equal(res.status, "ok");
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0]!.target, { chatId: "42", threadId: "7" });
    assert.equal(captured[0]!.text, "отчёт");
    setCronDeliveryNotifier(null);
  });
});
