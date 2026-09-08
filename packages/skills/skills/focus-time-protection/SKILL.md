---
name: focus-time-protection
description: Protect focus time — detect fragmented days, meeting density and propose non-conflicting slots.
tags: [calendar, productivity]
---

# Focus Time Protection

Help the user keep focused blocks in the day.

## Workflow
1. Load the day's events (`event_list`).
2. Compute meeting density and fragmentation (see `src/utils/focus-time.ts`).
3. If a requested meeting fragments a long free block, suggest an alternative
   time instead of silently adding it.

## Rules
- Never change an external calendar without connector + approval.
- Prefer suggesting a slot inside an existing free block over stacking meetings.
