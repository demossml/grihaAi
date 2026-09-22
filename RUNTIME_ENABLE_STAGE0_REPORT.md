# RUNTIME_ENABLE_STAGE0_REPORT.md

## STATUS: PARTIAL (Этап 0 done; Etapы 1–11 требуют deployment на macmini)

## Этап 0 — гигиена obs-потока (DONE)

**Причина шума:** `system-update.test.ts` вызывал `SystemUpdateService.run/status`,
чьи `emit(...)` с фейковыми `beforeSha` (`"same"/"old"/"new"/"abc123"`) писали в
реальный `~/.grish-ai/obs/` — в тестах `GRIHA_OBS` не был выключен.

**Фикс (commit `96a1ecd`):**
- `apps/agent/package.json` — test-скрипт теперь `GRIHA_OBS=0 tsx --test ...`
  (тесты не пишут в прод-obs).
- `apps/agent/tests/unit/allocator-obs.test.ts` — `beforeEach` явно `delete process.env.GRIHA_OBS`,
  чтобы obs-тесты продолжали проверять emit.

## Baseline (2026-09-22)

| Режим | Результат |
|---|---|
| flag off (default) | `npx turbo run typecheck test build` — **40/40**, **1415 tests pass**, lint **0** |
| flag on (sanity: GRIHA_AGENT_RUNTIME/GENERATION_POLICY/FLASH_ROUTER=1) | runtime+routing+generation — **64/66 pass**; 2 «провала» — это тесты «default off» (`isGenerationPolicyEnabled() false by default`, `isFlashRouterEnabled default false`), которые корректно падают, когда флаг явно включён в env |

## Что НЕ сделано (требует macmini + реальный трафик)

Etapы 1–11 — это **deployment/ops**: установить env-флаги в
`deploy/griha-ai.service` (`Environment=`), `systemctl restart griha-ai`,
наблюдать реальный трафик 24–48ч, завести staging-бота. Это недоступно из
локального workspace.

## Порядок включения (для оператора на macmini)

Каждый этап: `Environment=GRIHA_AGENT_RUNTIME=1` (+ суб-флаги) → restart →
наблюдение по obs → откат = снять `Environment=` → restart.

1. Наблюдение/безопасность (W8/W13) — `GRIHA_AGENT_RUNTIME=1`
2. Memory/Learning (W2/W5)
3. Context budget (W3)
4. Automation/Cron (W7)
5. Delegation (W6)
6. MCP (W9)
7. Proactive (W11)
8. Profiles (W12)
9. Skill versioning (W4) — сначала снять F3-риск
10. Telegram delivery (W10) — последним
11. Generation Policy + Flash Router (`GRIHA_GENERATION_POLICY`, `GRIHA_FLASH_ROUTER`)

## Откат
`flag off` = снять `Environment=` → restart. Без правок кода.

## STOP
Runtime-логика не менялась. Включение флагов — на стороне оператора.
