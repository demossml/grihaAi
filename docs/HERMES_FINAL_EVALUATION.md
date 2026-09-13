# HERMES → GRIHA — FINAL PARITY EVALUATION (Phase 17)

Дата: 2026-09-13. Основание: `HERMES_PARITY_MASTER_SPEC.md`, `docs/HERMES_PARITY_MATRIX.md`, `instr.md`.

## Итог матрицы (62 строки)

| Статус | Кол-во | Комментарий |
|---|---|---|
| COMPLETE | 17 | существующие Griha-возможности (Telegram-слой, sandbox, cron-ядро, память и др.) |
| PARTIAL | 43 | контракты/чистые функции Hermes-механик готовы в `src/runtime/`, wiring — за флагом |
| MISSING | 0 | — |
| NOT_APPLICABLE | 2 | C5 (prompt-cache у DeepSeek на стороне провайдера), F6 (offline-ассистент) |
| UNKNOWN | 0 | — |

## Выполненные фазы (0–16)

- Phase 0: аудит репозитория + parity matrix (62 строки).
- Phase 1: Agent Runtime interfaces (kernel + registry + флаг `HERMES_AGENT_RUNTIME`).
- Phase 2: Model Runtime (роли B1, TaskProfile-select B2, FallbackChain B3, context-window B4).
- Phase 3: Context Engine (token accounting C1, compaction decision C2, prune C3, summary C4).
- Phase 4: Session Engine (scroll D2, summaries D3, RRF).
- Phase 5: Memory Engine (контракт §10, candidate-пайплайн E5, scan E4; E3 верифицирован).
- Phase 6: Skill Engine (disclosure F1, LCS-diff F2, versioning+rollback F3 — урок #55647).
- Phase 7: Experience/Learning (routing G2, experience G3/G4, user model E8, quality F4, background G1).
- Phase 8: Delegation (limits+recursion protection H4, orchestrator H3, policy H5).
- Phase 9: Programmatic execution (plan/safety/preflight I1; sandbox-слой не тронут).
- Phase 10: Automation (J5 P02-схема с идемпотентной миграцией, AutomationEngine §21, script-jobs J4).
- Phase 11: Security (risk/approval K2, injection-stage K4, file safety K3, memory gate E6).
- Phase 12: MCP/Toolsets (registry L1, toolsets L2, conditional activation F8).
- Phase 13: Telegram (M4 delivery-контракт; M1–M3 сверены, код не менялся).
- Phase 14: Proactive (decision pipeline §28, nudge N2).
- Phase 15: Profiles (AgentProfile §29, registry, validation O1).
- Phase 16: Observability (telemetry §31 + correlation ID, cost accounting §32).

## Статистика

- Коммитов в проекте: 47 item-коммитов (по одному на item, линейная история).
- Новый код: `apps/agent/src/runtime/` — 17 подсистем, 63 файла.
- Тесты: **944/944 unit pass** (baseline Phase 0 = 678).
- Typecheck/build: `npx turbo run typecheck build` → 12/12.
- Lint: НЕ НАСТРОЕН в проекте (нет script) — остаётся как известный факт.
- БД: единственная миграция — J5 (3 nullable-колонки, idempotent, тесты clean/existing DB).
- Production-поведение: НЕ изменено (все новые модули не вызываются из prod-путей).

## Что осталось (осознанно, за флагом `HERMES_AGENT_RUNTIME`)

Включение (wiring) по подсистемам — следующий этап работы, отдельными item'ами:
1. Model Runtime: подключить select/fallback к вызовам (production defaults — отдельно).
2. Context: подключить shouldCompress/prune/summary в конвейер (LLM-резюме — aux B5).
3. Memory: pipeline E5 в SqliteRagMemoryService + scan на write-path + approval gate E6.
4. Skills: versioning в skill_manage + disclosure в prompt-формат.
5. Learning: background review (cheaper model) + experience SQLite (nullable).
6. Delegation: guard/orchestrator в SubAgentRunner.
7. Automation: update/remove/pause/resume в CronService + script-jobs; доставка Cron→TG (транспорт).
8. Security: risk-классификация в approval-gate, injection-stage в конвейер контента.
9. MCP: транспорт stdio/http (K7 credential isolation).
10. Telegram: J5-доставка (единственная точка, где появится изменение Telegram-слоя).
11. Proactive: event-system с policy.
12. Profiles: выбор профиля на бота/группу.
13. Observability: telemetry в runtime-вызовы + дашборд.

## Рекомендации по включению

- По одному item'у с VERIFIED-отчётом (instr.md §23), флаг остаётся off до полной проверки подсистемы.
- Высокорисковые подключения первыми: B3 fallback (production), I1 execute_code (безопасность),
  C2 compaction (не терять контекст), F3 skill rollback (данные).
- §33 regression suite: расширить integration-тесты на подключённые подсистемы
  (basic conversation, tool call, long conversation, context compression,
  session restoration, remember/contradiction, skill create/version/rollback,
  model routing/fallback, delegation recursion protection).

## Статус

**Hermes→Griha parity: контракты и чистые функции — готовы (PARTIAL по wiring).
MISSING: 0. Проект Phase 0–17 завершён.**
