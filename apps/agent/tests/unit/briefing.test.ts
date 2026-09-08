import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBriefing, localDayKey, isSameLocalDay } from "../../src/utils/briefing.js";

const NOW = new Date("2026-09-08T09:00:00Z");
const TZ = "Europe/Moscow";

describe("briefing timezone", () => {
  it("computes local day keys in the user timezone", () => {
    // 2026-09-08T00:00:00Z is 03:00 in Moscow → still 2026-09-08.
    assert.equal(localDayKey(NOW, TZ), "2026-09-08");
    // 23:30 UTC is already 02:30 next day in Moscow.
    assert.equal(isSameLocalDay(new Date("2026-09-07T23:30:00Z"), NOW, TZ), true);
    // 21:30 UTC is 00:30 next day in Moscow.
    assert.equal(isSameLocalDay(new Date("2026-09-08T21:30:00Z"), NOW, TZ), false);
  });
});

describe("daily briefing", () => {
  it("includes today's events and meetings", () => {
    const { items, text } = buildBriefing({
      events: [
        {
          id: "e1",
          title: "Созвон с Иваном",
          startsAt: "2026-09-08T06:30:00Z", // 09:30 MSK
          endsAt: "2026-09-08T07:30:00Z",
          kind: "meeting",
        },
        {
          id: "e2",
          title: "Событие вчера",
          startsAt: "2026-09-07T06:00:00Z",
          endsAt: "2026-09-07T07:00:00Z",
          kind: "event",
        },
      ],
      commitments: [],
      anomalies: [],
      approvals: [],
      clientNotes: [],
      now: NOW,
      timezone: TZ,
    });
    assert.ok(items.some((i) => i.title === "Созвон с Иваном"));
    assert.ok(!items.some((i) => i.title === "Событие вчера"));
    assert.ok(text.includes("Созвон с Иваном"));
  });

  it("includes overdue commitments and omits empty sections", () => {
    const { text } = buildBriefing({
      events: [],
      commitments: [{ id: "c1", text: "Отправить отчёт", status: "overdue" }],
      anomalies: [],
      approvals: [],
      clientNotes: [],
      now: NOW,
      timezone: TZ,
    });
    assert.ok(text.includes("Отправить отчёт"));
    assert.ok(!text.includes("Сегодня:"));
    assert.ok(!text.includes("Клиенты:"));
  });

  it("includes commitments due today", () => {
    const { items } = buildBriefing({
      events: [],
      commitments: [
        { id: "c1", text: "Позвонить клиенту", status: "open", dueDate: "2026-09-08T12:00:00Z" },
      ],
      anomalies: [],
      approvals: [],
      clientNotes: [],
      now: NOW,
      timezone: TZ,
    });
    assert.ok(items.some((i) => i.kind === "commitment" && i.title === "Позвонить клиенту"));
  });

  it("includes pending approvals", () => {
    const { items } = buildBriefing({
      events: [],
      commitments: [],
      anomalies: [],
      approvals: [{ id: "a1", action: "email.send" }],
      clientNotes: [],
      now: NOW,
      timezone: TZ,
    });
    assert.ok(items.some((i) => i.kind === "approval"));
  });
});
