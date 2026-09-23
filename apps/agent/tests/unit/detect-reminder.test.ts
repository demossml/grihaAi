import { test } from "node:test";
import assert from "node:assert/strict";
import { detectExplicitReminder } from "../../src/services/reminders/detect-reminder.js";

const now = new Date("2026-09-23T10:00:00");

test("«завтра созвон в 14:00» → dueAt завтра 14:00, confidence >= 0.5", () => {
  const r = detectExplicitReminder({ text: "завтра созвон в 14:00", now });
  assert.ok(r, "детект есть");
  assert.equal(r!.confidence >= 0.5, true);
  const expected = new Date("2026-09-24T14:00:00");
  assert.equal(r!.dueAt.getTime(), expected.getTime());
});

test("«напомни завтра в 15:00» → confidence 0.9", () => {
  const r = detectExplicitReminder({ text: "напомни завтра в 15:00", now });
  assert.ok(r);
  assert.equal(r!.confidence, 0.9);
});

test("«просто текст» → null", () => {
  assert.equal(detectExplicitReminder({ text: "просто текст", now }), null);
});

test("«после перекура через 5 минут» → null (относительное время не угадываем)", () => {
  assert.equal(detectExplicitReminder({ text: "после перекура через 5 минут", now }), null);
});

test("маркер без времени «напомни купить хлеб» → null", () => {
  assert.equal(detectExplicitReminder({ text: "напомни купить хлеб", now }), null);
});
