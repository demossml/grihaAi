# Hermes → Griha Task State

Current phase: 7
Current item: 7.5 (VERIFIED)
Status: IN_PROGRESS (Phase 8 — только после подтверждения пользователя)

Last completed items: 7.1–7.5 — Learning/Experience (routing/experience/user-model/quality/background)
Last commits: 6720c45 (7.1), cb30554 (7.2), 8b1cd92 (7.3), 32f4a51 (7.4), 7.5 (этот коммит)

## Baseline (зафиксирован 2026-09-13)

- tests: 678/678 PASS (`npx tsx --test "tests/unit/**/*.test.ts"`)
- typecheck: PASS (`npx turbo run typecheck`, 12/12)
- lint: NOT CONFIGURED (нет script)
- build: PASS (`npx turbo run build`, 12/12)
- git: main = cf5b6c0; archive/pre-rollback-2026-09-13 = 4d7ec9b

## Current objective

Phase 7 (VERIFIED): Experience Store + Learning (G1–G4, E8, F4) — маршрутизация
уроков, experience store, user model, quality score, background-review триггер.
Production не переключён.

## Current blockers

Нет.

## Files changed (Phase 0)

- docs/HERMES_PARITY_MATRIX.md (создан)
- docs/HERMES_IMPLEMENTATION_STATUS.md (создан)
- docs/HERMES_MIGRATION_CHANGELOG.md (создан)
- docs/HERMES_TASK_STATE.md (этот файл)
- (HERMES_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

Phase 8 (Delegation Engine, матрица H) — ТОЛЬКО после явного подтверждения
пользователя (Phase 7 заканчивается STOP). H1/H2 COMPLETE, H3 PARTIAL,
H4/H5 MISSING.

## Do not skip

- Перед Phase 1: перечитать HERMES_TASK_STATE.md → master spec → matrix.
- Baseline перед каждым item.
- План (## Item X.Y — Plan) до кода.
- Report по §23 instr.md после каждого item.
- Обновлять этот файл после каждого item.

## Phase 0 отчёт (краткий)

- Griha: 26 extensions, services (Users/documents), 29 skills, sandbox
  (local+runsc), SQLite-RAG (FTS5+vector+RRF), cron, multi-agent, approval.
- Hermes: docs + repo изучены (skills/memory/honcho/models/compression);
  остальные подсистемы — на уровне docs-описаний, детальное per-item
  исследование — в соответствующей фазе.
- Matrix: 62 строки, COMPLETE 17 / PARTIAL 20 / MISSING 21 / N/A 2.
- High-risk: B3 fallback, C2 compaction, F3 skill rollback, I1 execute_code,
  G1 background review.
