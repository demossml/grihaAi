---
name: client-notes-crm
description: Maintain structured client identity and notes without duplicating them in general memory.
tags: [crm]
---

# Client Notes CRM

Keep client identity structured and client notes separate.

## Workflow
1. For client identity (name, tags, last interaction): `contact_upsert` /
   `contact_touch` / `contact_list`.
2. For client notes (preferences, context): use `add_client_note` — do NOT
   duplicate them as generic memory facts.
3. Before interacting: `contact_briefing` aggregates notes + commitments.

## Rules
- Do not duplicate client notes in general memory.
- Record provenance for important notes.
