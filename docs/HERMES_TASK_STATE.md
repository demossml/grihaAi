# Hermes → Griha Task State

Current phase: W (Wiring)
Current item: W1 (VERIFIED)
Status: IN_PROGRESS (W2 — после подтверждения)

Last completed items: W1 — ModelRouter за флагом (flag off = старое поведение)
Last commits: 8fd6852 (17.1), W1 (этот коммит)

## Baseline (зафиксирован 2026-09-13)

- tests: 678/678 PASS (`npx tsx --test "tests/unit/**/*.test.ts"`)
- typecheck: PASS (`npx turbo run typecheck`, 12/12)
- lint: NOT CONFIGURED (нет script)
- build: PASS (`npx turbo run build`, 12/12)
- git: main = cf5b6c0; archive/pre-rollback-2026-09-13 = 4d7ec9b

## Current objective

Phase 17 (VERIFIED): Final parity evaluation — матрица COMPLETE 17 / PARTIAL 43
/ MISSING 0 / N/A 2; план поэтапного включения за флагом.

## Current blockers

Нет.

## Files changed (Phase 0)

- docs/HERMES_PARITY_MATRIX.md (создан)
- docs/HERMES_IMPLEMENTATION_STATUS.md (создан)
- docs/HERMES_MIGRATION_CHANGELOG.md (создан)
- docs/HERMES_TASK_STATE.md (этот файл)
- (HERMES_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

W2 (Memory pipeline в SqliteRagMemoryService за флагом) — по плану
docs/HERMES_FINAL_EVALUATION.md, ТОЛЬКО после явного подтверждения.

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
