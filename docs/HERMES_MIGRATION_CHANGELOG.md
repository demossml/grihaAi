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

## Откаченные миграции (справочно, НЕ в main)

В откаченной ветке `archive/pre-rollback-2026-09-13` были (P02):
`cron_jobs.chat_id/thread_id`, `cron_runs.delivery_status` (nullable).
При переносе P02 обратно (Phase 10) их нужно будет пересоздать через тот же
идемпотентный PRAGMA-паттерн — колонки в prod-БД могли остаться физически.
