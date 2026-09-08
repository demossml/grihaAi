# Griha AI — Skill Capability Matrix

Аудит состояния репозитория `grihaAi` относительно целевого каталога из 25 skills.
Источник истины — код (`apps/agent/.pi/extensions`, `packages/skills`, `packages/stt`, `packages/shared-types`), а не документация.

Легенда статусов:

- ✅ **Уже есть** — skill + runtime-инфраструктура реализованы и покрыты тестами.
- 🟡 **Частично** — есть часть инфраструктуры, но skill/логика отсутствуют или неполны.
- 🔴 **Нужно разработать** — нет ни skill, ни инфраструктуры.
- `—` — внешний connector на данном этапе не требуется (локальный fallback).

## 1. Calendar

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| calendar-scheduling | — | 🟡 (нет модели события) | Event-модель + connector-ready слой | Google Calendar / Outlook (позже) | approval на calendar.write |
| focus-time-protection | — | — | 🔴 | — | read-only |

## 2. Communication

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| correspondence | — | — | 🔴 draft workflow | email.send (позже) | approval перед отправкой |
| inbox-triage | — | — | 🔴 workflow (draft) | email.read (позже) | — |
| commitment-tracking | — | — | 🔴 Commitment-модель + сервис + извлечение | — | scoped to user |

## 3. Meetings

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| meeting-notes | — | 🟡 (есть meeting-minutes в documents) | skill-разделение | — | — |
| meeting-prep | — | — | 🔴 (использует Meeting + commitments + client notes) | calendar.read (позже) | read-only |
| meeting-followup | — | — | 🔴 (draft, отправка — approval) | email.send (позже) | approval |

## 4. Finance

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| expense-invoice-tracking | — | 🟡 (vision/OCR есть) | Expense-модель + сервис | accounting (позже) | approval на изменение сумм |
| transaction-categorization | — | — | 🔴 (user rules → history → model → confirm) | — | — |
| invoice-followup | — | — | 🔴 Invoice-модель + cron due/overdue | accounting (позже) | approval на отправку |
| approval-thresholds | — | — | 🔴 FinancialApprovalPolicy + сервис | — | core approval |
| financial-report | — | 🟡 (report-generator есть) | aggregation-сервис (детерминированные суммы) | — | read-only |

## 5. Documents

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| document-intake-ocr | — | 🟡 (vision `analyze_image` есть) | structured extraction + confidence pipeline | — | — |
| sales-report | ✅ (report-generator) | — | — | — | — |
| meeting-minutes | ✅ (report-generator) | — | — | — | — |
| document-drafting | — | — | 🔴 (LLM drafting, не фикс. шаблоны) | — | — |

## 6. CRM

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| client-notes-crm | — | 🟡 (`ClientNotesService` есть) | structured identity / tags / last-interaction | crm.read (позже) | scoped to user |
| contact-context-briefing | — | — | 🔴 (использует client notes + commitments) | — | read-only |

## 7. Travel

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| travel-coordination | — | 🟡 (OCR/PDF intake есть) | TravelItem + itinerary + cron reminders | travel.read/book (позже) | approval на travel.book |

## 8. Proactivity

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| daily-briefing | — | 🟡 (cron + monitorMode есть) | BriefingItem агрегация + timezone | — | read-only |
| anomaly-watch | — | — | 🔴 Anomaly-модель + baseline/threshold | — | read-only |

## 9. System

| Skill | Уже есть | Частично | Нужно разработать | Внешний connector | Безопасность |
|---|---|---|---|---|---|
| privacy-data-hygiene | — | 🟡 (политика в `core` skill) | код-level фильтр секретов в `memory_add` | — | core |
| delegation-triage | — | 🟡 (`adaptive-router` есть) | уточнение правил triage | — | — |
| voice-intake | — | 🟡 (STT `apps/api` /transcribe есть) | agent-tool + confidence/clarify pipeline | — | — |
| human-approval-gate | — | 🟡 (review-gate для skill-предложений) | Approval-модель + политика + gateway-интеграция | — | core |

---

## 2. Фактические реализации механизмов

| Механизм | Файл | API / tools | Persistence | Ограничения |
|---|---|---|---|---|
| Memory | `apps/agent/.pi/extensions/sqlite-rag-memory/*` | `memory_add`, `memory_search` | `~/.grish-ai/memory.sqlite` (facts/messages/insights) | общий синглтон; в Telegram-субсессиях не включён (общая БД) |
| Cron | `apps/agent/.pi/extensions/cron/*` | `cron_create/list/enable/disable/run_now/update_notepad`, `/cron` | `~/.grish-ai/cron.sqlite` | `monitorMode`, `continuity`, `stateSnapshot`, `notepad`; tick 60s |
| User rules | `apps/agent/.pi/extensions/user-rules/*` | `rules_*`, `/rules` | `~/.grish-ai/user-rules.sqlite` | hard (prefilter) / soft (injection) |
| Gateway | `apps/agent/.pi/extensions/gateway/*` + `src/utils/gateway-policy.ts` | `tool_call` → `{block, reason}` | — | trusted/untrusted; untrusted без shell/мутации |
| Confirmations | `ctx.ui.confirm` (review-gate для skill-предложений) | — | `~/.grish-ai/skill-proposals/*.json` | общего approval-gate НЕТ |
| Multi-agent | `apps/agent/.pi/extensions/multi-agent/*` + `src/utils/adaptive-router.ts` | `delegate_tasks`, `check_subagents`, `get_shared_insights`, `list_subagents`, `steer_subagent` | sqlite (memory subtree) | SIMPLE/COMPLEX по `classifyComplexity` |
| Client notes | `sqlite-rag-memory/ClientNotesService.ts` | `add_client_note`, `list_client_notes` | `memory.sqlite` (client_notes + FTS) | нет structured identity/tags |
| Report generation | `apps/agent/.pi/extensions/report-generator/*` + `src/utils/report-schemas.ts`, `report-renderer.ts` | `generate_report`, `generate_presentation` | `~/.grish-ai/reports/` | фикс. шаблоны; Playwright/pptxgenjs |
| OCR/vision | `apps/agent/.pi/extensions/model-router/*` + `src/utils/http-vision.ts`, `telegram-files.ts` | `analyze_image` | — | vision-модель из конфига |
| STT | `packages/stt/*` + `apps/api` | `POST /transcribe` | — | agent-tool НЕТ; Telegram-голос — заглушка |
| Telegram | `apps/agent/.pi/extensions/telegram-bot/*` | long polling + изолированные сессии | `~/.grish-ai/telegram/<id>/sessions` | доставка файлов через `sendDocument` |
| Skill registry | `packages/skills/src/*` | `discoverSkills`, `formatSkillsForPrompt` | `packages/skills/skills/*/SKILL.md` | frontmatter `name/description/tags/autoCreated` |

## 3. Gap-классификация (skill vs infrastructure)

| Gap | Классификация |
|---|---|
| human-approval-gate | New service + New tool + New approval policy + gateway-интеграция |
| approval-thresholds | New service + New persistent model + New policy |
| commitment-tracking | New service + New persistent model (`Commitment`) + New tool + New cron capability |
| voice-intake | Existing service extension (STT) + New tool + confidence pipeline |
| privacy-data-hygiene | Existing service extension (`memory_add` filter) + Skill |
| delegation-triage | Existing service extension (`adaptive-router`) + Skill |
| daily-briefing / anomaly-watch | New service + New cron capability + Skill |
| meeting-prep / meeting-followup | New persistent model (`Meeting`) + New service + Skill |
| calendar-scheduling / focus-time-protection | New persistent model (`Event`) + connector-ready слой + Skill |
| expense-invoice-tracking / invoice-followup | New persistent model (`Expense`, `Invoice`) + New service + New cron capability |
| transaction-categorization | New service + Skill |
| financial-report | New service (aggregation) + Existing report-generator |
| document-intake-ocr | Existing service extension (vision) + Skill |
| document-drafting | Skill-only (LLM drafting) |
| client-notes-crm | Existing service extension + Skill |
| contact-context-briefing | New service (aggregation) + Skill |
| travel-coordination | New persistent model (`TravelItem`) + New service + Skill |
| correspondence / inbox-triage | Skill + connector-ready capability layer |

## 4. Общие доменные сущности (без дубликатов)

Единые модели в `apps/agent/src/types/` + `@griha/shared-types` (для общих):

- `Commitment` — id, userId, text, dueDate?, status (`open|due_soon|overdue|completed|cancelled`), sourceType/sourceId, contactId?, meetingId?, confidence, provenance, createdAt/updatedAt.
- `Meeting` — id, userId, title, startsAt/endsAt, timezone, participants[], location?, agenda[], source, status.
- `Contact` — id, userId, name, tags[], lastInteractionAt, openCommitments (связь), preferences (provenance), provenance.
- `Expense` — id, userId, date, vendor, amount, currency, category?, paymentMethod?, documentId?, confidence, source, createdAt.
- `Invoice` — id, userId, number, amount, currency, dueDate, status (`draft|sent|due|overdue|paid|cancelled`), client/contactId, source, createdAt.
- `ApprovalPolicy` — id, userId, scope (`global|chat`), financial (`currency`, `autoApproveBelow?`, `alwaysConfirmAbove?`, `categoriesAlwaysConfirm?`), actionRules, createdAt/updatedAt.
- `BriefingItem` — id, userId, kind (`event|meeting|commitment|followup|client_note|anomaly|approval`), title, detail, dueAt?, severity?, createdAt.
- `Anomaly` — id, userId, type, severity, detectedAt, explanation, evidence, status (`new|acknowledged|resolved`).
- `TravelItem` — id, userId, tripId, kind (`flight|hotel|transfer|other`), title, startsAt/endsAt, location?, confirmationRef?, source, status.
- `Document` — id, userId, kind (`letter|memo|note|draft`), title, content, sourceType/sourceId, createdAt/updatedAt.

Все сущности: `userId` (scope), `id`, `createdAt/updatedAt`, `status`, `source`, `provenance`, ссылки на связанные сущности по `id`.
