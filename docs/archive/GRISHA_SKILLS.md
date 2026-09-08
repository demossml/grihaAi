# Griha AI — Canonical Skill Catalog

> Исторический документ (архив). Живой каталог skills — `docs/SKILLS.md`.

Полный каталог skills (в `packages/skills/skills/<name>/SKILL.md`) с их runtime,
инструментами, хранилищем, connector-требованиями и approval-правилами.

Registry: `@griha/skills` (`discoverSkills`, `formatSkillsForPrompt`). Обнаружение
рекурсивное, по `SKILL.md`; порядок — детерминированный (по `name`).

## Workflow graphs

### Meeting lifecycle

```
meeting-prep
   → встреча
   → meeting-notes
   → commitment-tracking  (action items → commitments)
   → meeting-followup     (summary + draft follow-up)
   → cron                 (периодические проверки дедлайнов)
   → completion tracking  (commitment_complete)
```

### Finance lifecycle

```
document-intake-ocr        (чек/счёт → OCR → структура → confirm)
   → expense-invoice-tracking
   → transaction-categorization   (rules → history → model → confirm)
   → approval-thresholds         (пороги подтверждения)
   → invoice-followup            (due/overdue)
   → financial-report            (детерминированная агрегация)
   → anomaly-watch               (spikes, duplicates, overdue)
```

### Executive lifecycle

```
input
   → context retrieval (memory_search, contact_briefing, meeting_prep)
   → task classification (delegation-triage / adaptive-router)
   → skill
   → tool/service
   → memory/state (commitments, expenses, notes)
   → cron (если действие в будущем)
   → briefing/follow-up
```

## Catalog

| Skill | Status | Runtime (tools) | Storage | Connector | Approval |
|---|---|---|---|---|---|
| human-approval-gate | READY | approval_required/status/grant/deny | approvals.sqlite | — | core |
| approval-thresholds | READY | policy_get/policy_set | approvals.sqlite | — | core |
| commitment-tracking | READY | commitment_add/list/update/complete/cancel | commitments.sqlite | — | — |
| voice-intake | READY | transcribe_voice | (tmp files) | — | — |
| privacy-data-hygiene | READY | memory_add (secret filter) | memory.sqlite | — | — |
| delegation-triage | READY | delegate_tasks (router) | — | — | — |
| daily-briefing | READY | briefing_generate | briefings.sqlite | — | — |
| anomaly-watch | READY | anomaly_list/ack | anomalies.sqlite | — | — |
| meeting-prep | READY | meeting_prep | calendar/commitments/memory | — | — |
| meeting-followup | READY | commitment_add (draft) | commitments.sqlite | email.send (позже) | email.send |
| contact-context-briefing | READY | contact_briefing | memory/commitments | — | — |
| calendar-scheduling | READY | event_add/list/cancel | calendar.sqlite | calendar.write (позже) | calendar.write |
| focus-time-protection | READY | focus-time utils (skill) | — | — | — |
| meeting-notes | READY | generate_report(meeting-minutes) | reports/ | — | — |
| meeting-minutes | READY | generate_report | reports/ | — | — |
| sales-report | READY | generate_report | reports/ | — | — |
| expense-invoice-tracking | READY | expense_add/list, invoice_add/list | finance.sqlite | accounting (позже) | invoice.pay |
| transaction-categorization | READY | transaction_categorize | finance.sqlite | — | — |
| invoice-followup | READY | invoice_list (draft reminder) | finance.sqlite | accounting (позже) | invoice.pay |
| financial-report | READY | finance_summary + generate_report | finance.sqlite | — | — |
| document-intake-ocr | READY | analyze_image → expense_add | finance.sqlite | — | — |
| document-drafting | READY | (LLM draft) | — | — | — |
| client-notes-crm | READY | contact_upsert/list/touch + add_client_note | contacts.sqlite / memory.sqlite | crm (позже) | — |
| correspondence | BLOCKED_BY_CONNECTOR | draft (LLM) | — | email.send | email.send |
| inbox-triage | BLOCKED_BY_CONNECTOR | classify/summarize (LLM) | — | email.read | — |
| travel-coordination | READY (book: BLOCKED) | travel_item_add/list/itinerary | travel.sqlite | travel.book | travel.book |

Статусы: `READY` — runtime реализован и протестирован; `BLOCKED_BY_CONNECTOR` —
локальный fallback реализован, внешнее действие недоступно до подключения connector.

## Shared entities (единые, без дубликатов)

- `Commitment` — commitments.sqlite
- `Contact` — contacts.sqlite
- `Document` — reports/ (fixed templates)
- `ApprovalRequest` / `ApprovalPolicyRecord` — approvals.sqlite
- `Anomaly` — anomalies.sqlite
- `BriefingItem` — вычисляется (briefing_runs для dedupe)
- `CalendarEvent` — calendar.sqlite
- `Expense` / `Invoice` — finance.sqlite
- `TravelItem` — travel.sqlite
