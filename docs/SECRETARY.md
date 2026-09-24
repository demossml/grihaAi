# Secretary mode — full contract (n2)

## 1. Role

Silent group archivist + mention-responding assistant + group reminders + explicit structured writes. Not a chatty participant.

## 2. Lifecycle diagram

```
Bot added to group
  │
  ▼
status=pending ──────────► group: NO replies (hard silence)
  │
  │ DM to owner: setup buttons / scenario
  ▼
scenario=secretary, status=completed
  │
  ▼
┌──────────────────────────────────────────┐
│ Inbound message                         │
│ → upsert participant                    │
│ → archive / OCR if media                │
│ → detectReminder if auto_reminders      │
│ → agent reply ONLY if mention/reply     │
└──────────────────────────────────────────┘
  │
archived ←── markArchived (data KEPT)
```

## 3. Rules R1–R10

**R1 Onboarding** — pending silent; configure in DM.
**R2 Behavior** — no reply without mention/reply; no unsolicited critique.
**R3 Scope** — group message ⇒ that chat only; DM ⇒ multi-group + ACL.
**R4 Documents** — OCR to archive; needs_review on low confidence.
**R5 Explicit write** — tool `secretary_record_expense` + payment_purpose dictionary.
**R6 Reminders** — regex detect; store; fire **in same group**; TZ `Europe/Moscow` (env `GRIHA_TZ`); `auto_reminders` checked **before add**; overdue >24h → expired not sent; `sourceMessageId` stored.
**R7 Roles** — registry userId+name; roles owner/admin/member/finance; setRole requires canManage.
**R8 Reports** — tools only; router kind report_dispatch.
**R9 Lifecycle** — archive status does not delete SQLite history.
**R10 Core** — uses shared Flash router + generation policy when flags on.

## 4. Payment purposes

materials, equipment, services, rent, utilities, taxes, collection, salary, household, transport, repair, advertising, refund, accountable, other (+ note).

## 5. Limitations

- No Telegram UI toggle for auto_reminders yet (function exists).
- needs_confirmation may not DM-notify yet.
- Reminder detect is regex, not full NLP.
