---
name: daily-briefing
description: Morning briefing aggregating today's events, meetings, overdue commitments, follow-ups, client notes, anomalies and pending approvals.
tags: [proactive, briefing]
---

# Daily Briefing

Summarize the working day compactly — no spam, no empty sections.

## Workflow
1. Call `briefing_generate` (pass the user's timezone when known from the profile).
2. Return the text as-is; do not invent facts that the tool did not return.
3. One briefing per day — the service suppresses duplicates automatically.

## Rules
- Never show empty sections.
- Never claim events/meetings that are not in the internal calendar.
- Format is compact (the tool already formats it).
