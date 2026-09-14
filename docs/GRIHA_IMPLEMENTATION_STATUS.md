# HERMES IMPLEMENTATION STATUS

Дата: 2026-09-13. Отражает статус каждой фазы. Обновляется после каждого item.

## Фазы

| Phase | Название | Статус | Комментарий |
|---|---|---|---|
| 0 | Repository audit + parity matrix | **IN_PROGRESS** (документы созданы) | завершается отчётом |
| 1 | Agent Runtime interfaces | **VERIFIED (item 1.1)** | `src/runtime/` interfaces + kernel + flag; prod не переключён |
| 2 | Model Runtime + Router + fallback | **VERIFIED (items 2.1–2.4)** | типы/select/fallback-chain/context-window — чистые функции, prod не переключён |
| 3 | Context Engine | **VERIFIED (items 3.1–3.4)** | usage/compaction/prune/summary — чистые функции, prod не переключён |
| 4 | Session Engine + Session Search | **VERIFIED (items 4.1–4.3)** | scroll-контракт + summaries store + RRF-фьюжн — prod не переключён |
| 5 | Memory Engine | **VERIFIED (items 5.1–5.3)** | E3 верифицирован; контракт §10 + пайплайн + in-memory store + scan — prod не переключён; E6 → Phase 11 |
| 6 | Skill Engine | **VERIFIED (items 6.1–6.3)** | disclosure + diff + versioning (урок #55647) — prod не переключён |
| 7 | Experience Store + Learning | **VERIFIED (items 7.1–7.5)** | routing/experience/user-model/quality/background — prod не переключён |
| 8 | Delegation | **VERIFIED (items 8.1–8.3)** | limits guard + orchestrator contract + policy — prod не переключён |
| 9 | Programmatic tool execution | **VERIFIED (items 9.1–9.3)** | execute_code план/безопасность/контракт; исполнение — существующий sandbox, prod не переключён |
| 10 | Automation / Cron | **VERIFIED (items 10.1–10.3)** | J5 P02-схема в main (без TG-wiring), AutomationEngine + script-jobs — prod-поведение не меняется |
| 11 | Security + Approval | **VERIFIED (items 11.1–11.4)** | RiskLevel/approval policy, injection-stage, file safety, memory write gate — prod не переключён |
| 12 | MCP + Toolsets | **VERIFIED (items 12.1–12.3)** | MCP registry, toolset policy (§23), conditional activation — prod не переключён |
| 13 | Telegram integration | **VERIFIED (items 13.1–13.2)** | M1–M3 сверены (код не менялся); M4 delivery-контракт (P02-семантика, без TG-изменений) |
| 14 | Proactive Agent | **VERIFIED (items 14.1–14.2)** | §28 decision pipeline (security выше proactive) + nudge-планировщик — prod не переключён |
| 15 | Agent Profiles / Bot Mode | **VERIFIED (items 15.1–15.2)** | профили §29 + registry + валидация — prod не переключён |
| 16 | Observability + Cost | **VERIFIED (items 16.1–16.2)** | §31 telemetry + correlation ID, §32 token/cost accounting — prod не переключён |
| 17 | Full parity evaluation | **VERIFIED (item 17.1)** | `docs/GRIHA_FINAL_EVALUATION.md`: MISSING=0, PARTIAL=43 (wiring за флагом), план включения |

## Сводка по матрице

- COMPLETE: 17 | PARTIAL: 43 | MISSING: 0 | NOT_APPLICABLE: 2 | UNKNOWN: 0
- High-risk MISSING: нет — все high-risk строки закрыты минимум до PARTIAL.

## Baseline (Phase 0, зафиксирован)

- `git`: main = `cf5b6c0` (rollback к `44834f1`); архив работ —
  `archive/pre-rollback-2026-09-13` (тег `pre-rollback-2026-09-13`).
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` → 678 pass / 0 fail.
- typecheck: `npx turbo run typecheck` → PASS (12/12).
- lint: **NOT CONFIGURED** (нет script в package.json).
- build: `npx turbo run build` → PASS (12/12).

## Правила ведения

- Статус меняется только на основании VERIFIED report (см. instr.md §23).
- Не переходить к следующей фазе, пока предыдущая не VERIFIED.
