# Griha AI — Skills (живой каталог)

> **Это единственный живой источник правды по skills; `docs/archive/` содержит только историю, не актуальное состояние.**

Источник истины по контенту каждого skill — **`packages/skills/skills/<name>/SKILL.md`**
(27 skill-директорий на момент 2026-09-08). Этот документ не повторяет SKILL.md,
а даёт только карту: что есть, на что опирается технически, какие connector/approval
задействованы.

Registry: `@griha/skills` (`discoverSkills`, `formatSkillsForPrompt`) — рекурсивное
обнаружение по `SKILL.md`, детерминированный порядок по `name`. Skills попадают в
system-prompt через `core-agent` (`before_agent_start`).

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

## Каталог (27 skills)

Статус по умолчанию — READY (runtime реализован и покрыт тестами). Исключения:
`correspondence`, `inbox-triage` — BLOCKED_BY_CONNECTOR (локальный draft есть,
внешнее действие — нет); `travel-coordination` — READY, но `travel.book` BLOCKED.

| Skill | Техническая опора | Connector | Approval |
|---|---|---|---|
| core | базовый system-prompt ассистента (инжектируется `core-agent`) | — | — |
| human-approval-gate | `approval_required/status/grant/deny/cancel` + `ApprovalService` | — | core |
| approval-thresholds | `policy_get/policy_set` (`FinancialApprovalPolicy`) | — | core |
| commitment-tracking | `commitment_add/list/update/complete/cancel` + `CommitmentService` | — | — |
| voice-intake | `transcribe_voice` (`@griha/stt`) + confidence-гейт | — | — |
| privacy-data-hygiene | фильтр секретов в `memory_add` (`secret-filter`) | — | — |
| delegation-triage | `delegate_tasks` + `adaptive-router` (`classifyComplexity`) | — | — |
| daily-briefing | `briefing_generate` + dedupe (`briefings.sqlite`) | — | — |
| anomaly-watch | `anomaly_list/ack` + детекторы (`anomalies.sqlite`) | — | — |
| meeting-prep | `meeting_prep` (агрегация calendar/commitments/memory) | — | — |
| meeting-followup | `commitment_add` (draft) из meeting notes | email.send (позже) | email.send |
| contact-context-briefing | `contact_briefing` (memory/commitments/notes) | — | — |
| calendar-scheduling | `event_add/list/cancel` (`calendar.sqlite`) | calendar.write (позже) | calendar.write |
| focus-time-protection | focus-time utils (`analyzeDay`/`suggestAlternative`) | — | — |
| meeting-notes | `generate_report(meeting-minutes)` | — | — |
| meeting-minutes | `generate_report(meeting-minutes)` | — | — |
| sales-report | `generate_report(sales-report)` | — | — |
| expense-invoice-tracking | `expense_add/list`, `invoice_add/list` (`finance.sqlite`) | accounting (позже) | invoice.pay |
| transaction-categorization | `transaction_categorize` (rules → history → model → confirm) | — | — |
| invoice-followup | `invoice_list` (draft reminder) | accounting (позже) | invoice.pay |
| financial-report | `finance_summary` + `generate_report` | — | — |
| document-intake-ocr | `analyze_image` (vision) → `expense_add` | — | — |
| document-drafting | LLM draft (письма/мемо) | — | — |
| client-notes-crm | `contact_upsert/list/touch` + `add_client_note` | crm (позже) | — |
| correspondence | LLM draft; отправка — только с connector | email.send | email.send |
| inbox-triage | classify/summarize (LLM); чтение — только с connector | email.read | — |
| travel-coordination | `travel_item_add/list/itinerary` (`travel.sqlite`) | travel.book | travel.book |

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

Канонические TypeScript-контракты сущностей — `apps/agent/src/types/domain.ts`.
