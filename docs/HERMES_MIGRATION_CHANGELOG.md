# HERMES MIGRATION CHANGELOG

Журнал изменений схем/данных Griha DB в ходе переноса Hermes-механик.

Правила (instr.md §12):
- Griha DB — единственная основная DB; никаких отдельных «Hermes DB».
- Миграции: forward-compatible, nullable где возможно, idempotent,
  non-destructive, тест на clean DB и на existing-DB fixture.
- Никаких DROP/DELETE существующих данных.

## История

| Дата | Item | Изменение | Файлы | Тесты | Статус |
|---|---|---|---|---|---|
| 2026-09-13 | Phase 0 | **Нет изменений** (research only) | — | — | — |
| 2026-09-13 | 1.1 (Agent Runtime interfaces) | **Нет изменений БД** (только код/тесты) | — | — | — |
| 2026-09-13 | 2.1 (Model roles/policies) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 2.2 (TaskProfile select) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 2.3 (FallbackChain) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 2.4 (Context window chain) | `ModelConfig.contextWindow` — optional поле типа (обратно совместимо, не DB) | packages/shared-types/src/index.ts | — | — |
| 2026-09-13 | 3.1 (Token accounting) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 3.2 (Compaction decision) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 3.3 (Tool result pruning) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 3.4 (Structured summary) | **Нет изменений БД** (persistSummary — сериализация, SQLite-wiring позже) | — | — | — |
| 2026-09-13 | 4.1 (Session scroll) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 4.2 (Session summaries) | **Нет изменений БД** (in-memory store) | — | — | — |
| 2026-09-13 | 4.3 (Session RRF) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 5.1 (E3 verification) | **Нет изменений** (docs) | — | — | — |
| 2026-09-13 | 5.2 (Memory pipeline) | **Нет изменений БД** (in-memory store) | — | — | — |
| 2026-09-13 | 5.3 (Memory scan) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 6.1 (Skill disclosure) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 6.2 (Skill diff) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 6.3 (Skill versioning) | **Нет изменений БД** (in-memory) | — | — | — |
| 2026-09-13 | 7.1 (Lesson routing) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 7.2 (Experience store) | **Нет изменений БД** (in-memory) | — | — | — |
| 2026-09-13 | 7.3 (User model) | **Нет изменений БД** (in-memory) | — | — | — |
| 2026-09-13 | 7.4 (Skill quality) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 7.5 (Background review trigger) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 8.1 (Delegation limits) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 8.2 (Orchestrator contract) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 8.3 (Delegation policy) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 9.1 (Execute_code plan) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 9.2 (Code risk gate) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 9.3 (Execute_code contract) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 10.1 (J5/P02 schema) | `cron_jobs` + `chat_id`, `thread_id`; `cron_runs` + `delivery_status` — nullable, idempotent PRAGMA-ALTER | CronService.ts, types/index.ts | cron-j5-migration.test.ts (clean + existing DB + повторный init) | — |
| 2026-09-13 | 10.2 (AutomationEngine) | **Нет изменений БД** (in-memory контракт) | — | — | — |
| 2026-09-13 | 10.3 (Script jobs) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 11.1 (Risk levels) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 11.2 (Injection stage) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 11.3 (File safety) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 11.4 (Memory write gate) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 12.1 (MCP registry) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 12.2 (Toolsets) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 12.3 (Conditional activation) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 13.1 (Cron→TG delivery contract) | **Нет изменений БД** (схема — J5) | — | — | — |
| 2026-09-13 | 13.2 (M1–M3 сверка) | **Нет изменений** (docs) | — | — | — |
| 2026-09-13 | 14.1 (Proactive decision) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 14.2 (Nudge scheduling) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 15.1 (Agent profiles) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 15.2 (Profile validation) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 16.1 (Token/cost accounting) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 16.2 (Telemetry) | **Нет изменений БД** | — | — | — |
| 2026-09-13 | 17.1 (Final evaluation) | **Нет изменений** (docs) | — | — | — |
| 2026-09-13 | W1 (ModelRouter wiring) | **Нет изменений БД** | model-router.ts | wiring-model-router.test.ts | — |
| 2026-09-13 | W2 (Memory write gate) | **Нет изменений БД** | MemoryService.ts | wiring-memory.test.ts | — |
| 2026-09-13 | W3 (Context budget guard) | **Нет изменений БД** | ContextBuilder.ts | wiring-context.test.ts | — |
| 2026-09-13 | W4 (Skill versioning on write) | **Нет изменений БД** | skill-improver.ts | wiring-skill.test.ts | — |
| 2026-09-13 | W5 (Learning lesson routing) | **Нет изменений БД** | learning-extractor.ts | wiring-learning.test.ts | — |
| 2026-09-13 | W6 (Delegation gate in runner) | **Нет изменений БД** | RealSubAgentRunner.ts | wiring-delegation.test.ts | — |
| 2026-09-13 | W7 (Automation: update/remove/pause/resume + script-jobs) | +`script`, `script_args` (cron_jobs, nullable, идемпотентно) | CronService.ts, cron/index.ts, types/index.ts | wiring-automation.test.ts | — |
| 2026-09-13 | W8 (Runtime risk в approval-gate) | **Нет изменений БД** | approval-gate/index.ts, runtime-risk.ts | wiring-security.test.ts | — |
| 2026-09-13 | W9 (MCP транспорт stdio/http + runtime) | **Нет изменений БД** | runtime/mcp/transport.ts, mcp-runtime/*, shared-types (`mcp.servers`) | wiring-mcp.test.ts | — |
| 2026-09-13 | W10 (Cron→TG доставка, P02) | **Нет изменений БД** (J5-колонки уже в main) | cron/delivery-wiring.ts, CronService.ts, cron/index.ts, telegram-bot/index.ts (notifier) | wiring-telegram-delivery.test.ts | — |
| 2026-09-13 | W11 (Proactive event-gate + nudge) | **Нет изменений БД** | proactive-gate.ts, proactive-assistant/index.ts | wiring-proactive.test.ts | — |
| 2026-09-13 | W12 (Bot profiles: persona-секция) | **Нет изменений БД** | core-agent/profile-section.ts, core-agent/index.ts, shared-types (`profile`) | wiring-profiles.test.ts | — |
| 2026-09-13 | W13 (Telemetry/cost в ModelRouter.call) | **Нет изменений БД** | runtime-observability.ts, model-router.ts | wiring-observability.test.ts | — |
| 2026-09-13 | B3 (FallbackChain в ModelRouter.call) | **Нет изменений БД** | model-router.ts, runtime-observability.ts, shared-types (`models.fallbackModels`) | wiring-fallback.test.ts | — |

## Откаченные миграции (справочно, НЕ в main)

В откаченной ветке `archive/pre-rollback-2026-09-13` были (P02):
`cron_jobs.chat_id/thread_id`, `cron_runs.delivery_status` (nullable).
При переносе P02 обратно (Phase 10) их нужно будет пересоздать через тот же
идемпотентный PRAGMA-паттерн — колонки в prod-БД могли остаться физически.
