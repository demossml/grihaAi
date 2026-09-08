# Griha AI — Domain Architecture

Целевая слоистая модель после hardening. Описывает границы ответственности, а не
построчную реализацию (см. `CURRENT_ARCHITECTURE.md` — аудит, `ARCHITECTURE.md` —
общая картина, `EXTENSIONS.md` — пофайловый справочник).

## Слои

```
Transport            → telegram-bot (long polling + изолированные сессии)
Session / Identity   → sessionId + per-session context (user-rules/context.ts)
Core Agent           → pi runtime + core-agent system-prompt (оркестратор)
Skill Router         → список skills в system-prompt (LLM выбирает capability)
Context Builder      → src/context/ContextBuilder.ts (единая сборка контекста)
Policy / Approval    → gateway (технич.) + approval-policy + approval-gate
Workflow             → src/workflow/workflows.ts (meeting / finance)
Domain Services      → CommitmentService, FinanceService, CalendarService, …
Tools / Cron / Providers → tools, deterministic cron tasks, provider-интерфейсы
Persistence          → SQLite-сервисы (WAL)
```

Отдельные сквозные механизмы: Memory (знания/контекст), Structured State
(операционное состояние), Capabilities, Policies, Approvals, Events.

## Ключевое разделение

1. **Memory ≠ Structured State.** Memory (`memory.sqlite`: facts/messages/insights)
   хранит знания и историю. Structured State (commitments/expenses/invoices/
   contacts/events/anomalies/approvals) — отдельные SQLite-файлы.
2. **Gateway ≠ Policy ≠ Approval.**
   - Gateway — техническая граница (`tool_call`, trusted/untrusted).
   - Policy — разрешено ли действие пользователю в контексте (financial thresholds,
     user rules с `ruleClass`).
   - Approval — существует ли действующее явное подтверждение
     (`scope: ONCE|SESSION|WORKFLOW`, статусы `pending|approved|rejected|expired|cancelled`).
   - Поток: Agent → Capability Check → Policy Check → Approval Check → Execute / Reject / Ask.
3. **Capability Registry** — единый источник возможностей (`src/utils/capabilities.ts`,
   статусы `AVAILABLE|UNAVAILABLE|REQUIRES_CONNECTION|REQUIRES_APPROVAL`).
4. **ContextBuilder** — skills не сканируют всю память; контекст собирается в одном месте.
5. **Workflow** — координирует шаги; skill = capability; service = business logic;
   provider = внешняя система.

## Domain contracts

`src/types/domain.ts` — канонические контракты:

- **Commitment** — `id, userId, actor, action, target, deadline, status, source,
  sourceMessageId, meetingId, contactId, confidence, completedAt`. Статусы
  `open|due_soon|overdue|completed|cancelled` (due_soon/overdue выводятся из deadline).
- **Approval** — `id, userId, sessionId, action, actionClass, target, args, scope,
  status, expiresAt`. Scope `ONCE|SESSION|WORKFLOW`.
- **Anomaly** — `type, severity, detectedAt, explanation, evidence, status`.
- **Briefing** — `userId, dayKey, text, ranAt` (dedupe по user+day).
- **Meeting / CalendarEvent** — `kind: meeting|event|focus|other`.
- **Contact** — identity + tags + lastInteraction + provenance (notes отдельно).
- **Invoice / Expense** — финансы (`FinanceService`).
- **Task** — единица работы субагента/cron.

## Providers

`src/providers/providers.ts` — интерфейсы `CalendarProvider`, `EmailProvider`,
`CRMProvider`, `TravelProvider`, `AccountingProvider`. Сейчас все — `noop`
(возвращают `ok:false` + описание лимита), кроме локального `email.draft`.
Реальные API не подключены; fake success запрещён.

## Sub-agent capabilities

`src/capabilities/subagent-capabilities.ts` — явный allowlist. Субагенты
(untrusted) могут только `memory.search`, `ocr.process`, `report.pdf`, `report.pptx`.
Запрещены write/side-effect/approval-gated capabilities.

## Deterministic cron

`src/cron/deterministic-tasks.ts` — cron сначала выполняет детерминированные
запросы к сервисам (`daily-briefing`, `anomaly-scan`, `commitment-due-scan`),
и только потом LLM синтезирует. Cron никогда не просит LLM «прочитать всю память».

## Learning guard

`src/utils/learning/skill-improver.ts` (`isProtectedSkillContent`) — авто-дообучение не
предлагает/не применяет изменения в domains: security, approval, permission,
restriction, financial policy/limits. Protected skill names:
`human-approval-gate`, `approval-thresholds`, `privacy-data-hygiene`, `delegation-triage`.
