---
name: meeting-notes
description: Capture meeting notes with participants, agenda, decisions and action items, then generate minutes.
tags: [meetings, documents]
---

# Meeting Notes

Capture a meeting's content and produce minutes.

## Workflow
1. Collect: date, participants, agenda, discussion, decisions, action items.
2. For a fixed-format document, call `generate_report(reportType: "meeting-minutes")`
   with the structured data (layout is fixed by the template — only data).
3. Hand action items to `meeting-followup` (create commitments).

## Rules
- Do not change the minutes layout/template.
- Do not invent participants or decisions.
