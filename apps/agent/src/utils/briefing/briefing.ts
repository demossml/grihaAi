import type { BriefingItem, CalendarEvent } from "../../types/index.js";

/**
 * Daily briefing — pure aggregation. The extension gathers data from services;
 * this module turns it into a compact, non-spamming briefing with empty
 * sections omitted and all time math done in the user's timezone.
 */

export interface BriefingEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  kind?: string;
}

export interface BriefingCommitment {
  id: string;
  text: string;
  dueDate?: string;
  status: string;
}

export interface BriefingData {
  events: BriefingEvent[];
  commitments: BriefingCommitment[];
  anomalies: Array<{ id: string; type: string; severity: string; explanation: string; status?: string }>;
  approvals: Array<{ id: string; action: string }>;
  clientNotes: Array<{ id: string; content: string }>;
  now: Date;
  timezone: string;
}

/** Local calendar-day key in the given IANA timezone (e.g. "2026-09-08"). */
export function localDayKey(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // Unknown timezone → fall back to UTC date.
    return date.toISOString().slice(0, 10);
  }
}

export function isSameLocalDay(a: Date, b: Date, timezone: string): boolean {
  return localDayKey(a, timezone) === localDayKey(b, timezone);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function toMinutes(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function formatClock(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

export function buildBriefing(data: BriefingData): { items: BriefingItem[]; text: string } {
  const items: BriefingItem[] = [];
  const { now, timezone } = data;
  const todayKey = localDayKey(now, timezone);

  // 1. Today's events (non-cancelled, local day == today).
  const todaysEvents = data.events
    .filter((e) => isSameLocalDay(new Date(e.startsAt), now, timezone))
    .sort((a, b) => toMinutes(a.startsAt) - toMinutes(b.startsAt));
  for (const e of todaysEvents) {
    items.push({
      kind: e.kind === "meeting" ? "meeting" : "event",
      title: e.title,
      detail: `${formatClock(e.startsAt, timezone)} — ${formatClock(e.endsAt, timezone)}`,
      dueAt: e.startsAt,
    });
  }

  // 2. Upcoming meetings in the next 48h (beyond today).
  const soonEnd = now.getTime() + 2 * DAY;
  const upcoming = data.events
    .filter(
      (e) =>
        e.kind === "meeting" &&
        toMinutes(e.startsAt) > now.getTime() &&
        toMinutes(e.startsAt) <= soonEnd &&
        !isSameLocalDay(new Date(e.startsAt), now, timezone),
    )
    .sort((a, b) => toMinutes(a.startsAt) - toMinutes(b.startsAt));
  for (const e of upcoming) {
    items.push({
      kind: "meeting",
      title: e.title,
      detail: `${localDayKey(new Date(e.startsAt), timezone)} ${formatClock(e.startsAt, timezone)}`,
      dueAt: e.startsAt,
    });
  }

  // 3. Overdue commitments.
  for (const c of data.commitments.filter((c) => c.status === "overdue")) {
    items.push({
      kind: "commitment",
      title: c.text,
      detail: "просрочено",
      severity: "critical",
      dueAt: c.dueDate,
    });
  }

  // 4. Commitments due today (open or due_soon).
  for (const c of data.commitments.filter((c) => {
    if (c.status !== "open" && c.status !== "due_soon") return false;
    return c.dueDate ? isSameLocalDay(new Date(c.dueDate), now, timezone) : false;
  })) {
    items.push({ kind: "commitment", title: c.text, detail: "сегодня", severity: "warning", dueAt: c.dueDate });
  }

  // 5. Follow-ups (due_soon within next 24h, not today).
  for (const c of data.commitments.filter((c) => {
    if (c.status !== "due_soon") return false;
    if (!c.dueDate) return false;
    const t = toMinutes(c.dueDate);
    return t > now.getTime() && t <= now.getTime() + DAY;
  })) {
    items.push({ kind: "followup", title: c.text, detail: "скоро", severity: "warning", dueAt: c.dueDate });
  }

  // 6. New anomalies.
  for (const a of data.anomalies.filter((a) => a.status === "new" || !a.status)) {
    items.push({
      kind: "anomaly",
      title: a.explanation,
      detail: a.type,
      severity: a.severity === "critical" ? "critical" : "warning",
    });
  }

  // 7. Pending approvals.
  for (const a of data.approvals) {
    items.push({ kind: "approval", title: a.action, detail: "ожидает подтверждения", severity: "warning" });
  }

  // 8. Recent client notes.
  for (const n of data.clientNotes) {
    items.push({ kind: "client_note", title: n.content, detail: "заметка о клиенте" });
  }

  return { items, text: formatBriefing(items, data.now, timezone) };
}

function formatBriefing(items: BriefingItem[], now: Date, timezone: string): string {
  const groups: Array<{ header: string; kind: BriefingItem["kind"] }> = [
    { header: "Сегодня", kind: "event" },
    { header: "Сегодня", kind: "meeting" },
    { header: "Требует внимания", kind: "commitment" },
    { header: "Follow-ups", kind: "followup" },
    { header: "Аномалии", kind: "anomaly" },
    { header: "Ожидают подтверждения", kind: "approval" },
    { header: "Клиенты", kind: "client_note" },
  ];

  const lines: string[] = [`Доброе утро. ${localDayKey(now, timezone)}`];
  for (const group of groups) {
    const section = items.filter((i) => i.kind === group.kind);
    if (section.length === 0) continue;
    lines.push("", group.header + ":");
    for (const item of section) {
      const prefix = item.detail ? `${item.detail}: ` : "";
      lines.push(`• ${prefix}${item.title}`);
    }
  }
  return lines.join("\n");
}
