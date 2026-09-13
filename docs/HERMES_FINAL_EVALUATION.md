# HERMES → GRIHA — FINAL PARITY EVALUATION (Phase 17)

Дата: 2026-09-13. Основание: `HERMES_PARITY_MASTER_SPEC.md`, `docs/HERMES_PARITY_MATRIX.md`, `instr.md`.

## Итог матрицы (70 строк)

| Статус | Кол-во | Комментарий |
|---|---|---|
| COMPLETE | 38 | существующие Griha-возможности + все 13 wiring-подключений (W1–W13) + B3 fallback + I1 execute_code + C4 summary + K4 injection |
| PARTIAL | 29 | контракты/логика готовы; остаётся финальное включение рисковых подсистем (C2-гигиена/F3) и отдельные шаги (дашборд, runsc-MCP, thread_id, profile-override) |
| MISSING | 1 | F7 slash-команды по скиллам (низкий приоритет, задокументировано) |
| NOT_APPLICABLE | 2 | C5 (prompt-cache у провайдера), F6 (offline-ассистент) |
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
- Phase 13: Telegram (M4 delivery-контракт; M1–M3 сверены; W10: доставка подключена за флагом — единственная правка TG-слоя, notifier).
- Phase 14: Proactive (decision pipeline §28, nudge N2).
- Phase 15: Profiles (AgentProfile §29, registry, validation O1).
- Phase 16: Observability (telemetry §31 + correlation ID, cost accounting §32; W13: подключено в ModelRouter.call).

## Стадия Wiring (W1–W13) — завершена 2026-09-13

13/13 VERIFIED-отчётов; коммиты b3c4772…dc4f121 (W5–W13) и W1–W4 ранее;
все запушены в origin/main. Флаг `HERMES_AGENT_RUNTIME` off по умолчанию.

## Статистика

- Коммитов в проекте: 60 item-коммитов (по одному на item, линейная история).
- Новый код: `apps/agent/src/runtime/` — 17 подсистем, 63+ файла + 13 wiring-модулей.
- Тесты: **1033/1033 unit pass** (baseline Phase 0 = 678).
- Регрессия с флагом on (`HERMES_AGENT_RUNTIME=1`): **1033/1033 pass**.
- Typecheck/build: `npx turbo run typecheck build` → 12/12.
- Lint: НЕ НАСТРОЕН в проекте (нет script) — остаётся как известный факт.
- БД: миграции — J5 (nullable, idempotent) + W7 (`script`/`script_args`, nullable, idempotent); тесты clean/existing DB.
- Production-поведение: НЕ изменено (флаг off = 1:1; все подключения за `HERMES_AGENT_RUNTIME`).

## Что осталось (осознанно, за флагом `HERMES_AGENT_RUNTIME`)

Все 13 пунктов плана wiring — **VERIFIED и запушены**:
1. ✅ W1 ModelRouter (resolveModelConfig + selectForTask).
2. ✅ W2 Memory write gate (scanDecision + approval) в SqliteRagMemoryService.
3. ✅ W3 Context budget guard (estimateTokens + usableBudget + приоритетное ужатие) в ContextBuilder.
4. ✅ W4 Skill versioning на core-edit (SkillVersionStore, активный SKILL.md не меняется).
5. ✅ W5 Lesson routing в applyLearning (routes: factual/procedural/preference/drop).
6. ✅ W6 Delegation guard (depth/timeout/budget) в createRealSubAgentRunner.
7. ✅ W7 Automation: update/remove/pause/resume + script-jobs в CronService.
8. ✅ W8 Security: runtime risk-классификация в approval-gate.
9. ✅ W9 MCP: транспорт stdio/http + McpSessionRuntime (K7 credential isolation).
10. ✅ W10 Telegram: Cron→TG доставка с P02-ретраями (единственная правка TG-слоя — notifier).
11. ✅ W11 Proactive: event-gate (§28) + nudge-тикер в proactive-assistant.
12. ✅ W12 Profiles: persona-секция профиля бота в system prompt.
13. ✅ W13 Observability: telemetry + cost-учёт в ModelRouter.call.

Осознанно отложено (документировано в матрице): B5 отдельные aux-модели,
C2 раздельная gateway-гигиена (pruneToolResults), F3 активное
переключение версий скиллов, дашборд
observability, runsc-апгрейд MCP, thread_id-доставка, групповой
profile-override, F7 slash-команды по скиллам (MISSING, низкий приоритет).
B3 fallback, I1 execute_code, структурная компакция (C2/C4) и
injection-stage (K4) — подключены (post-wiring, за флагом).

## Рекомендации по включению в production

1. Сначала — shadow mode: `HERMES_AGENT_RUNTIME=1` на dev/staging с наблюдением
   (все 13 точек уже VERIFIED отдельно; обе регрессии 1033/1033).
2. Последовательное включение на проде по риску: сперва наблюдение/безопасность
   (W8 risk-gate, W13 telemetry), затем memory/learning (W2/W5), context (W3),
   automation (W7), delegation (W6), MCP (W9), proactive (W11), profiles (W12),
   skill versioning (W4) — перед включением снять F3-риск (данные) отдельным
   прогоном.
3. Telegram-доставка (W10) включается только с реальным тестом отправки в
   тестовый чат (единственная точка изменения TG-слоя).
4. B3 fallback в prod-вызовах — отдельный item с тестом provider-failure.
5. §33 regression suite: расширять integration-тесты на подключённые подсистемы
   по мере включения.

## Статус

**Hermes→Griha parity: Phases 0–17 + Wiring W1–W13 завершены. MISSING: 1
(F7, низкий приоритет). Все подключения за флагом, off = старое поведение 1:1.
Обе регрессии (off и on) — 1033/1033, typecheck/build 12/12.**
