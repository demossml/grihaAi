# FLASH_ROUTER_PHASE2_REPORT.md

## STATUS: VERIFIED

## FILES
- `apps/agent/src/runtime/routing/types.ts` (новый)
- `apps/agent/src/runtime/routing/rule-route.ts` (новый)
- `apps/agent/src/runtime/routing/flash-route.ts` (новый)
- `apps/agent/src/runtime/routing/route-message.ts` (новый)
- `apps/agent/src/runtime/routing/resolve-config.ts` (новый)
- `apps/agent/src/runtime/routing/index.ts` (новый)
- `apps/agent/src/runtime/model/types.ts` — `TaskProfile.complexity?: TaskComplexity`
- `apps/agent/src/runtime/index.ts` — `export * from "./routing/index.js"`
- `apps/agent/src/utils/routing/model-router.ts` — `selectRoutingDecision`/`callWithDecision`/`logGenerationBudget`
- `apps/agent/tests/unit/routing/{rule-route,flash-route,route-message,generation-integration}.test.ts` (новые)
- `docs/FLASH_ROUTER.md` (новый), `docs/GENERATION_POLICY.md`, `STATUS.md`, `README.md`

## FLAGS default OFF
- `GRIHA_FLASH_ROUTER` — OFF (1:1, тест `isFlashRouterEnabled default false`)
- `GRIHA_GENERATION_POLICY` — OFF (как в Phase 1)

## WIRE pool
- **deferred** (API + тесты готовы: `ModelRouter.selectRoutingDecision` + `callWithDecision`).
  Сбор `RoutingContext` в TelegramSessionPool — отдельная точка, не в этом этапе.

## TESTS
- `npx tsx --test apps/agent/tests/unit/routing/*.test.ts apps/agent/tests/unit/generation/*.test.ts` — **56 passed / 0 failed**
  (rule-route 5, flash-route 5, route-message 4, generation-integration 1 + generation 17)

## TYPECHECK/BUILD
- `npx turbo run typecheck test build` — **40/40 successful**
- `npm run lint` — **0 ошибок**

## DOCS
- `docs/FLASH_ROUTER.md` (flags, rule table, Flash short-context, no ACL/sums, parse→fallback, map flash→model)
- `docs/GENERATION_POLICY.md` — «complexity теперь из router»
- `STATUS.md` — Phase 42; `README.md` — секция «Flash Router»

## EXAMPLE decisions
- image → `{ role: vision, complexity: simple, kind: vision_ocr, source: rule }`
- «итог расходов» → `{ role: flash, complexity: trivial, kind: report_dispatch, source: rule }`
- «почему выросли» → `{ role: main, complexity: complex, kind: analysis, source: rule }`

## Notes
- JS `\b` не видит кириллицу → `rule-route` использует цельнословный `hasWord` (boundary вручную),
  чтобы «отчёт»/«расход»/«проанализируй» детектились; поведение сохранено, тесты зелёные.
- Flash получает только `RoutingContext` (userText ≤1500), без истории/chat id/ACL/сумм.

## Commit
- `feat(runtime): Phase 2 Flash router (rule+LLM, flag off) + complexity wiring`

## STOP
Calibration auto-apply (Phase 3) и secretary silence rules — не тронуты.
