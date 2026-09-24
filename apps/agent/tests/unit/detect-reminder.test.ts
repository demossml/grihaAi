import { test } from "node:test";
import assert from "node:assert/strict";
import { detectExplicitReminder } from "../../src/services/reminders/detect-reminder.js";

// 2026-09-23 10:00 UTC = 13:00 Москвы (UTC+3).
const now = new Date("2026-09-23T10:00:00Z");

test("«завтра созвон в 14:00» → dueAt завтра 14:00 Москвы (11:00Z), confidence 0.9", () => {
  const r = detectExplicitReminder({ text: "завтра созвон в 14:00", now });
  assert.ok(r, "детект есть");
  assert.equal(r!.confidence, 0.9);
  assert.equal(r!.dueAt.toISOString(), "2026-09-24T11:00:00.000Z");
});

test("«напомни завтра в 15:00» → confidence 0.9", () => {
  const r = detectExplicitReminder({ text: "напомни завтра в 15:00", now });
  assert.ok(r);
  assert.equal(r!.confidence, 0.9);
});

test("«напомни завтра» (date only) → confidence 0.7, dueAt 09:00 Москвы", () => {
  const r = detectExplicitReminder({ text: "напомни завтра", now });
  assert.ok(r);
  assert.equal(r!.confidence, 0.7);
  assert.equal(r!.dueAt.toISOString(), "2026-09-24T06:00:00.000Z");
});

test("«напомни через 5 минут» → confidence 0.4 (needs_confirmation)", () => {
  const r = detectExplicitReminder({ text: "напомни через 5 минут", now });
  assert.ok(r);
  assert.equal(r!.confidence, 0.4);
  assert.equal(r!.dueAt.getTime(), now.getTime() + 5 * 60_000);
});

test("«просто текст» → null", () => {
  assert.equal(detectExplicitReminder({ text: "просто текст", now }), null);
});

test("«после перекура через 5 минут» → null (нет маркера)", () => {
  assert.equal(detectExplicitReminder({ text: "после перекура через 5 минут", now }), null);
});

test("«напомни купить хлеб» (без даты/времени) → null", () => {
  assert.equal(detectExplicitReminder({ text: "напомни купить хлеб", now }), null);
});
