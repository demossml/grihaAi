---
name: calendar-scheduling
description: Manage the internal calendar (events) in a connector-ready way — never claim an external calendar was changed.
tags: [calendar]
---

# Calendar Scheduling

Grisha keeps an internal calendar. External calendars are not connected yet.

## Workflow
1. To add a known event: `event_add` (title, startsAt, endsAt, timezone,
   participants, kind).
2. To view events: `event_list`.
3. To cancel: `event_cancel`.

## Rules
- Never claim a Google/Outlook calendar was changed — the connector is absent.
- For `calendar.write` on an external system, a connector + approval is
  required. Until then, only the internal calendar is updated.
