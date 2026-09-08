---
name: meeting-prep
description: Gather context before a meeting — the meeting itself, related commitments and client notes.
tags: [meetings]
---

# Meeting Prep

Prepare the user for a meeting using only facts Grisha actually knows.

## Workflow
1. Call `meeting_prep` with the event id.
2. Present the returned context compactly: meeting, participants, location,
   open commitments, related client notes.
3. If the meeting is not in the internal calendar, say so — do not invent
   participants or times.

## Rules
- Never fabricate participants, times or documents.
- If the calendar connector is absent, work only with known events.
