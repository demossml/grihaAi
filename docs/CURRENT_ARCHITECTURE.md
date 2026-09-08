# Current Architecture — Audit (Phase 0)

Аудит фактического кода `grihaAi` перед hardening. Источник истины — код, а не README.

## 1. Фактическая архитектура

Монорепа (npm workspaces + Turborepo). Бизнес-логика — **расширения pi.dev** в
`apps/agent/.pi/extensions/` (автозагрузка по glob из `.pi/settings.json`).

Каждое расширение — `index.ts` с `export default function (pi: ExtensionAPI)`:
подписка на события, регистрация LLM-инструментов (`registerTool`) и slash-команд.

## 2. Ответственность компонентов

| Компонент | Ответственность |
|---|---|
| `first-run-setup` | Мастер настройки провайдера/модели/ключа |
| `core-agent` | System-prompt: skills, политика делегирования, language policy, router-hint. `/skills`. **Тонкий** — не God Object. |
| `sqlite-rag-memory` | Гибридная память (facts/messages/insights) + ClientNotes + UserProfile |
| `multi-agent` | Делегирование, BotRegistry, SubAgentManager, Shared Insights |
| `cron` | Планировщик (CronService) + real runner/change-detector |
| `model-router` | main/vision-маршрутизация + `analyze_image` |
| `personal-learning` | Профиль, заметки, авто-дообучение, skill proposals (review-gated) |
| `telegram-bot` | Long polling + изолированные AgentSession на пользователя |
| `user-rules` | hard/soft-правила + prefilter + инъекция + Telegram-контекст |
| `gateway` | Единая блокировка side-effect tool-calls (trusted/untrusted) |
| `report-generator` | PDF/PPTX по фикс. шаблонам |
| `approval-gate` | Approval-запросы + финансовые пороги |
| `commitment-tracking` | Обязательства (structured state) |
| `voice-intake` | `transcribe_voice` (STT) + confidence-гейт |
| `proactive-assistant` | Календарь, брифинг, аномалии, meeting_prep/contact_briefing |
| `finance` | Расходы/счета/категоризация/сводка |
| `crm` | Контакты |
| `travel` | Поездки |
| `connector` | Capability report |

## 3. Где хранится state

| Хранилище | Файл | Владелец |
|---|---|---|
| Memory (facts/messages/insights) | `~/.grish-ai/memory.sqlite` | sqlite-rag-memory |
| Client notes / User profile | `memory.sqlite` (таблицы) | sqlite-rag-memory |
| Commitments | `commitments.sqlite` | commitment-tracking |
| Approvals / policies | `approvals.sqlite` | approval-gate |
| Calendar events | `calendar.sqlite` | proactive-assistant |
| Anomalies | `anomalies.sqlite` | proactive-assistant |
| Briefing runs (dedupe) | `briefings.sqlite` | proactive-assistant |
| Expenses / invoices | `finance.sqlite` | finance |
| Contacts | `contacts.sqlite` | crm |
| Travel items | `travel.sqlite` | travel |
| Cron jobs/runs | `memory.sqlite` (таблицы cron_*) | cron |
| User rules | `user-rules.sqlite` | user-rules |

**Вывод**: Memory (знания/контекст) и Structured State (операционное состояние)
уже частично разделены, но cron живёт в `memory.sqlite`, а client notes — в той
же БД, что и memory. Точка для hardening: физически разделить таблицы cron и
state-сущности от memory.sqlite.

## 4. Где выполняются side effects

- `gateway` (`tool_call`) — блокирует shell/мутацию для untrusted.
- `invoice_set_status("paid")` — финансовое действие, проверяет approval policy.
- Telegram `sendDocument`/`sendMessage` — реальная отправка.
- Остальные инструменты — внутренние мутации (SQLite), без внешнего эффекта.

Внешних connectors (gmail/calendar/travel/crm/accounting) **нет** — только
connector-ready boundary (`src/utils/capabilities.ts`).

## 5. Где принимаются permission decisions

- `gateway` — техническая граница (trust level).
- `approval-gate` (`src/utils/approval-policy.ts`) — классификация действия +
  финансовые пороги.
- `user-rules` prefilter — hard-правила «отвечай только мне».

**Вывод**: gateway и policy уже разделены концептуально, но approval-модель
не имеет scope (ONCE/SESSION/WORKFLOW) и статусов CANCELLED; user rules не
разделены на Preference/Policy/Permission/Restriction.

## 6. Routing

- `adaptive-router` (`classifyComplexity`) → SIMPLE/COMPLEX → `delegate_tasks`.
- `model-router` → main/vision.
- Skill-выбор — через system-prompt (`core-agent` инжектирует список skills),
  реального «skill router» как компонента нет — выбор делает LLM.

## 7. Context

Контекст строится децентрализованно: `core-agent` (skills+политики),
`personal-learning` (профиль+заметки), `user-rules` (правила+Telegram-контекст)
— каждый сам дописывает system-prompt. Единого `ContextBuilder` нет;
`meeting_prep`/`contact_briefing` собирают контекст точечно.

## 8. Переиспользуемые механизмы

- `provider-bootstrap` (`applyConfig`) — провайдер/модель.
- DI-паттерн (fetch/render/runner/фабрики бота) — для тестов.
- per-session registry (`session-files.ts`, `user-rules/context.ts`).
- SQLite-service паттерн (`init()`/`close()`, WAL).

## 9. Реальное дублирование

- Cron-таблицы в `memory.sqlite` (не отдельный файл) — пересечение Memory и
  Structured State.
- `resolveUserId` через `getSessionContext` продублирован в approval-gate,
  commitment-tracking, proactive-assistant, finance, crm, travel.
- Commitment-модель имеет и «старые» (text/who/toWhom/dueDate) и «целевые»
  поля (actor/action/target/deadline) — требуется контракт.
- Capability-информация частично в `capabilities.ts` и частично в skills-тексте.

## 10. Точки для hardening

1. Единый `ContextBuilder` (Phase 3).
2. Workflow-слой (Phase 3).
3. Capability Registry с 4 статусами (Phase 2).
4. Approval scope/expiration (Phase 2).
5. Разделение user rules на Preference/Policy/Permission/Restriction (Phase 2).
6. Deterministic cron → service query → event → LLM synthesis (Phase 5).
7. Commitment contract (actor/action/target/deadline) (Phase 1).
8. Физическое разделение state-БД (Phase 1/7).
9. Provider-интерфейсы (Phase 3).

## Mapping: current component → target layer

| Текущий компонент | Целевой слой |
|---|---|
| telegram-bot | Transport + Session/Identity |
| pi runtime + core-agent prompt | Core Agent / Orchestrator |
| core-agent (skills list) + LLM | Skill Router |
| (нет) | Context Builder |
| gateway + approval-gate + user-rules | Policy / Approval |
| (нет) | Workflow |
| finance/crm/travel/commitment/proactive services | Domain Services |
| cron/model-router/report-generator | Tools / Cron / Providers |
| SQLite-сервисы | Persistence |
| sqlite-rag-memory | Memory |
| commitments/expenses/invoices/… | Structured State |
| capabilities.ts | Capabilities |
| approval-gate | Policies / Approvals |
