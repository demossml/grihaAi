# Hermes → Griha Task State

Current phase: 0
Current item: 0 (Phase 0 report)
Status: IN_PROGRESS

Last completed item: none
Last commit: cf5b6c0 (ROLLBACK к 44834f1)

## Baseline (зафиксирован 2026-09-13)

- tests: 678/678 PASS (`npx tsx --test "tests/unit/**/*.test.ts"`)
- typecheck: PASS (`npx turbo run typecheck`, 12/12)
- lint: NOT CONFIGURED (нет script)
- build: PASS (`npx turbo run build`, 12/12)
- git: main = cf5b6c0; archive/pre-rollback-2026-09-13 = 4d7ec9b

## Current objective

Phase 0 (research only): инвентарь Griha, поведение Hermes, parity matrix,
4 документа, отчёт. Production-код НЕ менять.

## Current blockers

Нет.

## Files changed (Phase 0)

- docs/HERMES_PARITY_MATRIX.md (создан)
- docs/HERMES_IMPLEMENTATION_STATUS.md (создан)
- docs/HERMES_MIGRATION_CHANGELOG.md (создан)
- docs/HERMES_TASK_STATE.md (этот файл)
- (HERMES_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

Phase 1 (Agent Runtime interfaces) — ТОЛЬКО после явного подтверждения
пользователя (Phase 0 заканчивается STOP).

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
