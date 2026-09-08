---
name: commitment-tracking
description: Track commitments (who owes what, to whom, by when). Use when the user promises something, delegates an obligation, or a meeting produces action items.
tags: [system, state, meetings]
---

# Commitment Tracking

A commitment is a structured fact: who, what, to whom, deadline, source, confidence.

## When to activate
- "Я отправлю договор завтра."
- "Напомни мне позвонить клиенту в пятницу."
- Meeting action items.

## Workflow
1. Extract: text (what), who, toWhom, dueDate, source.
2. If any critical detail is unclear and confidence is low — ask before creating.
3. Call `commitment_add` (set `confidence` honestly; below ~0.6 you should ask).
4. Track with `commitment_list`; close with `commitment_complete` / `commitment_cancel`.

## Statuses
`open` → `due_soon` (≤24h before deadline) → `overdue` (past deadline) → `completed` / `cancelled`.
Statuses are derived from the due date — never set `due_soon`/`overdue` by hand.

## Rules
- Never create a commitment from an uncertain statement without clarifying.
- Link to the source message/session/contact/meeting when available.
- A completed commitment stays in history; do not delete without user request.
