---
name: meeting-followup
description: Turn meeting notes into a summary, decisions, action items and commitments, and prepare a follow-up draft.
tags: [meetings]
---

# Meeting Followup

After meeting notes are captured, close the loop.

## Workflow
1. Summarize the meeting.
2. Extract decisions.
3. Extract action items (who / what / by when).
4. For each action item, call `commitment_add` (link `meetingId` / source).
5. Prepare a follow-up message as a **draft**.

## Rules
- Sending the follow-up outside requires `approval_required` (`email.send` /
  messenger) — without a connector, only produce the draft.
- Do not create a commitment from an unclear action item without asking.
