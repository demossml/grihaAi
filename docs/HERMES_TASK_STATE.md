# Hermes → Griha Task State

Current phase: 2
Current item: 2.4 (VERIFIED)
Status: IN_PROGRESS (Phase 3 — только после подтверждения пользователя)

Last completed items: 2.1–2.4 — Model Runtime (типы/select/fallback/context-window)
Last commits: f1ca33b (2.1), 8d4b5d3 (2.2), b4ebb00 (2.3), 2.4 (этот коммит)

## Baseline (зафиксирован 2026-09-13)

- tests: 678/678 PASS (`npx tsx --test "tests/unit/**/*.test.ts"`)
- typecheck: PASS (`npx turbo run typecheck`, 12/12)
- lint: NOT CONFIGURED (нет script)
- build: PASS (`npx turbo run build`, 12/12)
- git: main = cf5b6c0; archive/pre-rollback-2026-09-13 = 4d7ec9b

## Current objective

Phase 2 (VERIFIED): Model Runtime + Router + fallback (B1–B4) — типы и чистые
функции, production-код не переключён.

## Current blockers

Нет.

## Files changed (Phase 0)

- docs/HERMES_PARITY_MATRIX.md (создан)
- docs/HERMES_IMPLEMENTATION_STATUS.md (создан)
- docs/HERMES_MIGRATION_CHANGELOG.md (создан)
- docs/HERMES_TASK_STATE.md (этот файл)
- (HERMES_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

Phase 3 (Context Engine, матрица C) — ТОЛЬКО после явного подтверждения
пользователя (Phase 2 заканчивается STOP). High-risk: C2 context compaction.

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
