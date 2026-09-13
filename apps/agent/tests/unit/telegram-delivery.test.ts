/**
 * Item 13.1 (M4): контракт Cron → Telegram доставки (P02-семантика).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeliveryError,
  deliveryStatusFromError,
  shouldRetry,
} from "../../src/runtime/telegram/delivery.js";

describe("Telegram delivery contract (Item 13.1)", () => {
  it("429/5xx/сеть → temporary", () => {
    assert.equal(classifyDeliveryError({ status: 429 }), "temporary");
    assert.equal(classifyDeliveryError({ status: 503 }), "temporary");
    assert.equal(classifyDeliveryError(new Error("ETIMEDOUT")), "temporary");
  });

  it("400/403/chat not found/blocked → permanent", () => {
    assert.equal(classifyDeliveryError({ status: 403 }), "permanent");
    assert.equal(classifyDeliveryError(new Error("chat not found")), "permanent");
    assert.equal(classifyDeliveryError(new Error("bot was blocked by the user")), "permanent");
  });

  it("мусор → unknown", () => {
    assert.equal(classifyDeliveryError(new Error("weird")), "unknown");
    assert.equal(classifyDeliveryError(undefined), "unknown");
  });

  it("shouldRetry: temporary → retry до исчерпания лимита (P02: 2 доп. ретрая)", () => {
    assert.equal(shouldRetry("temporary", 1).retry, true);
    assert.equal(shouldRetry("temporary", 3).retry, false);
    assert.equal(shouldRetry("permanent", 1).retry, false);
    assert.equal(shouldRetry("unknown", 1).retry, false);
  });

  it("deliveryStatusFromError: permanent → permanent_failure", () => {
    assert.equal(deliveryStatusFromError("permanent"), "permanent_failure");
    assert.equal(deliveryStatusFromError("temporary"), "failed");
    assert.equal(deliveryStatusFromError("unknown"), "failed");
  });

  it("execution≠delivery: deliveryStatus не влияет на status задачи (контракт)", () => {
    // Статус задачи ("success"/"failed") живёт в cron_runs.status отдельно от
    // cron_runs.delivery_status — это J5-схема; здесь проверяем, что контракт
    // доставки возвращает только свой статус.
    const status = deliveryStatusFromError(classifyDeliveryError({ status: 503 }));
    assert.ok(["ok", "failed", "permanent_failure", "skipped"].includes(status));
  });
});
