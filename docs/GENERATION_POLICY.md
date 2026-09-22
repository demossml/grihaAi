# Generation Policy (Phase 1)

Детерминированный слой бюджетов генерации: **без LLM, без сети**.

## Purpose (Phase 1)

`TaskComplexity + TaskKind → GenerationPolicy.resolve → GenerationBudget →
BudgetAllocator.allocate/canExtend/nextExtension`. Чистые функции + тонкий сервис.
Модуль не вызывает LLM и не ходит в сеть.

## Env

- `GRIHA_GENERATION_POLICY=1|true|yes` — включить (по умолчанию **OFF** = старое
  поведение 1:1). Флаг OFF обязателен тестом `flag-off-compat`.

## Profiles (gp-1.0.0)

| complexity | temperature | initial | soft | hard | step | maxExtensions |
|---|---|---|---|---|---|---|
| trivial | 0.2 | 256 | 512 | 1024 | 256 | 1 |
| simple | 0.3 | 512 | 1024 | 2048 | 512 | 2 |
| medium | 0.5 | 1024 | 2048 | 4096 | 512 | 2 |
| complex | 0.6 | 2048 | 4096 | 8192 | 1024 | 3 |

`CODE_HARD_CAP_OUTPUT_TOKENS = 8192` — code-level ceiling; config/env не поднимают
hard выше. `modelMaxTokens` режет hard/soft/initial по потолку модели.

Коэффициенты kind (initial only): `analysis ×1.25`, `report_dispatch/compression ×0.5`,
`tool_orchestration/vision_ocr ×0.75`, `chat_reply/other ×1.0`.

## Invariants

- `initialMaxTokens <= softMaxTokens <= hardMaxTokens`
- `hardMaxTokens <= CODE_HARD_CAP_OUTPUT_TOKENS`
- `extensionStepTokens > 0`, `maxExtensions >= 0`

## API

- `resolveGenerationBudget(input) -> GenerationBudget` — главная чистая функция.
- `mergeProfile(base, override)` — override только сужает (не поднимает hard выше cap).
- `createExtensionState` / `tryExtendBudget` / `applyExtension` — расширение бюджета
  (не выше hard, не больше maxExtensions).
- `budgetToRuntimeParams(budget) -> { temperature, maxTokens, policyVersion }` —
  параметры для вызова модели (`ModelConfig` в shared-types не имеет temp/maxTokens).
- `applyGenerationBudgetToModelConfig(config, budget)` — shallow copy без мутации.
- `isGenerationPolicyEnabled(env)` — feature flag.

## Wire (minimal)

`ModelRouter.call` под флагом вычисляет бюджет (`main → medium`, `vision → simple`)
и логирует `budgetToRuntimeParams`. Проброс temp/maxTokens в фактический API-вызов —
Phase 2 (Flash router / GenerationEngine), не в этом этапе.

## Next phases (не сделано)

- `TaskProfile.complexity` wiring (сейчас default medium/simple).
- Flash LLM router (Phase 2).
- GenerationEvaluator (extension decision).
