# DOCS_SYNC_REPORT.md

## STATUS: VERIFIED

## INVENTORY (EXISTS/MISSING)

CORE / GENERATION — все EXISTS:
- `apps/agent/src/runtime/generation/*` (types/profiles/policy/allocator/allocator-obs/apply-to-config/flag/index)
- `GRIHA_GENERATION_POLICY` flag
- `docs/GENERATION_POLICY.md`
- `pool-apply-budget.ts` / `applyBudgetToModel`

ROUTING / FLASH — все EXISTS:
- `apps/agent/src/runtime/routing/*` (types/rule-route/flash-route/route-message/resolve-config/index)
- `GRIHA_FLASH_ROUTER` flag
- `pool-routing.ts`, `pool-call-flash.ts`
- `TelegramSessionPool` wire (`preparePoolRouting`)
- `docs/FLASH_ROUTER.md`

OBSERVABILITY — все EXISTS:
- `packages/observability` (emit/helpers/query code+eventPrefix, threadId/code)
- turn.start/end, routing.decision, generation.budget/finish, extend helper
- `docs/OBSERVABILITY.md`
- `obs_query` tool

MISSING: ничего (все обязательные файлы на месте).

## DOCS TOUCHED
- `docs/GENERATION_POLICY.md` — API += tryExtendBudgetWithObs; + What is NOT done; + Related.
- `docs/FLASH_ROUTER.md` — исправлена устаревшая «callFlash НЕ wired»; + Model on user prompt; + Related.
- `docs/OBSERVABILITY.md` — + Honest limitations; + Related.
- `docs/TELEGRAM-BOT.md` — + «Routing, budget, observability (Telegram path)».
- `docs/ARCHITECTURE.md` — + ссылки на три docs в «Смежные документы».
- `STATUS.md` — сводная секция «Core runtime: Generation Policy + Flash Router + Observability v2».
- `README.md` — уже содержал секции Generation Policy / Flash Router / Observability (не менялся).

## LIMITATIONS documented (честно)
- `generation.extend` runtime multi-pass — **no** (helper есть, runtime не вызывает).
- `generation.finish` usageAvailable — **false** (pi не отдаёт usage) ⇒ truncation по длине не детектится.
- Flash role НЕ переключает session model на генерацию (только `createCallFlash`).
- Флаги default OFF везде согласованы.

## PUSH
sha — после коммита.

## STOP
Runtime-код не менялся. Phase 3 не начат.
