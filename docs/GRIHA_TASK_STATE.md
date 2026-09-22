# Griha Task State

Current phase: R (Post-wiring / production enablement)
Current item: Этап 0 — гигиена obs-потока (DONE, commit 96a1ecd)
Status: готово к финальному включению (shadow mode → prod)

## Этап 0 — гигиена (2026-09-22)

- Причина шума: `system-update.test.ts` вызывал `SystemUpdateService.run/status`,
  чьи `emit(...)` с фейковыми `beforeSha` ("same"/"old"/"new"/"abc123") писали в
  реальный `~/.grish-ai/obs/` (GRIHA_OBS не был выключен в тестах).
- Фикс: `apps/agent/package.json` test-скрипт теперь `GRIHA_OBS=0 tsx --test ...`;
  `allocator-obs.test.ts` явно включает emit в `beforeEach` (delete GRIHA_OBS).
- Baseline (flag off): 1415 tests pass, turbo 40/40, lint 0.
- Etapы 1–11 (включение флагов) — deployment/ops на macmini, не в этом workspace.

Last completed items: глобальное переименование (файлы/текст/флаг) + lint + golden
Last commits: 41d69be (ссылки), переименование (этот коммит)

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

- docs/GRIHA_PARITY_MATRIX.md (создан)
- docs/GRIHA_IMPLEMENTATION_STATUS.md (создан)
- docs/GRIHA_MIGRATION_CHANGELOG.md (создан)
- docs/GRIHA_TASK_STATE.md (этот файл)
- (GRIHA_PARITY_MASTER_SPEC.md, instr.md — файлы пользователя, untracked)

## Next item

W6 (Delegation: guard/orchestrator в SubAgentRunner за флагом) — по плану
docs/GRIHA_FINAL_EVALUATION.md, ТОЛЬКО после явного подтверждения.

## Do not skip

- Перед Phase 1: перечитать GRIHA_TASK_STATE.md → master spec → matrix.
- Baseline перед каждым item.
- План (## Item X.Y — Plan) до кода.
- Report по §23 instr.md после каждого item.
- Обновлять этот файл после каждого item.

## Phase 0 отчёт (краткий)

- Griha: 26 extensions, services (Users/documents), 29 skills, sandbox
  (local+runsc), SQLite-RAG (FTS5+vector+RRF), cron, multi-agent, approval.
- Griha: docs + repo изучены (skills/memory/honcho/models/compression);
  остальные подсистемы — на уровне docs-описаний, детальное per-item
  исследование — в соответствующей фазе.
- Matrix: 62 строки, COMPLETE 17 / PARTIAL 20 / MISSING 21 / N/A 2.
- High-risk: B3 fallback, C2 compaction, F3 skill rollback, I1 execute_code,
  G1 background review. (B3/C2/G1/I1 — VERIFIED, F3 — в работе)
