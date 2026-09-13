# Hermes → Griha Task State

Current phase: 4
Current item: 4.3 (VERIFIED)
Status: IN_PROGRESS (Phase 5 — только после подтверждения пользователя)

Last completed items: 4.1–4.3 — Session (scroll contract / summaries store / RRF)
Last commits: 2df750d (4.1), f861567 (4.2), 4.3 (этот коммит)

## Baseline (зафиксирован 2026-09-13)

- tests: 678/678 PASS (`npx tsx --test "tests/unit/**/*.test.ts"`)
- typecheck: PASS (`npx turbo run typecheck`, 12/12)
- lint: NOT CONFIGURED (нет script)
- build: PASS (`npx turbo run build`, 12/12)
- git: main = cf5b6c0; archive/pre-rollback-2026-09-13 = 4d7ec9b

## Current objective

Phase 4 (VERIFIED): Session Engine + Session Search (D2/D3) — scroll-контракт,
session summaries store, RRF-фьюжн. Чистые функции, production не переключён.

## Current blockers

Нет.

## Files changed (Phase 0)

- docs/HERMES_PARITY_MATRIX.md (создан)
- docs/HERMES_IMPLEMENTATION_STATUS.md (создан)
- docs/HERMES_MIGRATION_CHANGELOG.md (создан)
- docs/HERMES_TASK_STATE.md (этот файл)
- (HERMES_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

Phase 5 (Memory Engine, матрица E) — ТОЛЬКО после явного подтверждения
пользователя (Phase 4 заканчивается STOP). E1/E2/E3 COMPLETE, E5/E6 MISSING.

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
