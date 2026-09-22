# GENERATION_POLICY_PHASE1_REPORT.md

## STATUS: VERIFIED

## READ files
- `apps/agent/src/runtime/model/types.ts` — `ModelPolicy`, `DEFAULT_MODEL_POLICIES`, `modelPolicyFor(role)`.
- `apps/agent/src/runtime/model/select.ts` — `TaskProfile`, `selectModelRole`.
- `apps/agent/src/utils/routing/model-router.ts` — `class ModelRouter`, `getConfig(role)`, `call(role, messages)`.
- `apps/agent/src/utils/bootstrap/provider-bootstrap.ts` — `makeModel()` (maxTokens: 16384).
- `packages/shared-types/src/index.ts` — `ModelConfig` НЕ имеет `temperature`/`maxTokens`
  (только `{ provider, model, apiKey?, baseUrl?, contextWindow? }`).
- grep `GenerationPolicy|BudgetAllocator` — до этапа отсутствовал (создан с нуля).

## GENERATION files created
- `apps/agent/src/runtime/generation/types.ts`
- `apps/agent/src/runtime/generation/profiles.ts`
- `apps/agent/src/runtime/generation/policy.ts`
- `apps/agent/src/runtime/generation/allocator.ts`
- `apps/agent/src/runtime/generation/apply-to-config.ts`
- `apps/agent/src/runtime/generation/flag.ts`
- `apps/agent/src/runtime/generation/index.ts`
- `apps/agent/src/runtime/index.ts` — добавлен `export * from "./generation/index.js";`

## WIRE
- **yes** (минимальный, флаг **default OFF**).
- `ModelRouter.call` под `isGenerationPolicyEnabled(this.env)` вычисляет
  `resolveGenerationBudget(...)` + `budgetToRuntimeParams(...)` и логирует `console.debug`.
- Legacy поведение (флаг off) — 1:1, без fallback/проброса параметров.
- `ModelConfig` не имеет temp/maxTokens → используется `RuntimeGenerationParams`
  (локальный тип) + `budgetToRuntimeParams` (проброс в фактический API — Phase 2).

## TESTS
- `npx tsx --test apps/agent/tests/unit/generation/*.test.ts` — **17 passed / 0 failed**
  (profiles 3, policy 5, allocator 5, apply-to-config 2, flag-off-compat 2).

## TYPECHECK/BUILD
- `npx turbo run typecheck test build` — **40/40 successful**.
- `npm run lint` — **0 ошибок**.

## DOCS
- `docs/GENERATION_POLICY.md` — Purpose, env, PROFILES table, invariants, API, «NO LLM», next phases.
- `STATUS.md` — Phase 41: Generation Policy + Budget Allocator.
- `README.md` — секция «Generation Policy».

## INVARIANTS checked
- **yes** — `initialMaxTokens <= softMaxTokens <= hardMaxTokens`;
  `hardMaxTokens <= CODE_HARD_CAP_OUTPUT_TOKENS (8192)`; `extensionStepTokens > 0`;
  `maxExtensions >= 0`; проверены в `profiles.test.ts` / `policy.test.ts`.

## DEFAULT complexity mapping
- main → `medium` (`DEFAULT_MAIN_COMPLEXITY`)
- vision → `simple` (`DEFAULT_VISION_COMPLEXITY`)

## Commit
- `dfa74d5` — `feat(runtime): GenerationPolicy + BudgetAllocator (gp-1.0.0, flag off)` → pushed `origin/main`.

## STOP
Phase 1 завершён. Phase 2 (Flash LLM router) и `TaskProfile.complexity` wiring — НЕ начаты.
