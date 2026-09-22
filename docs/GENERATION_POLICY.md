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

## complexity теперь из router

С Phase 2 (Flash Router) `complexity`/`kind` приходят из `RoutingDecision`
(`ModelRouter.callWithDecision`), а не из default-констант. См. `docs/FLASH_ROUTER.md`.

## Budget apply (Telegram pool)

При `GRIHA_GENERATION_POLICY=1` `ModelRouter.callWithDecision` передаёт
`maxTokens = budget.initialMaxTokens` и `temperature = budget.temperature` в
`ModelCaller` (параметр `gen`). Флаг off → `gen` не передаётся (1:1).

## Telegram / pi apply (Phase 2.3)

**Стратегия: `set_model` (STRATEGY B).**

pi `session.prompt` не принимает per-turn maxTokens/temperature (тип
`PromptOptions` — expandPromptTemplates/images/streamingBehavior/source/
preflightResult). Поэтому бюджет применяется через `session.setModel`:

- `TelegramSessionPool.runPrompt` (`apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts`):
  после `preparePoolRouting`, если `budget` есть — `session.setModel(applyBudgetToModel(session.model, budget))`.
- `applyBudgetToModel` (`pool-apply-budget.ts`) клонирует pi `Model`:
  `maxTokens = budget.initialMaxTokens`, `samplingParams.temperature = budget.temperature`.
- Восстановление модели — в `finish` (terminal state хода), fire-and-forget.
- `budgetApplied: true` в obs ТОЛЬКО когда `setModel` реально применился
  (`budgetApplyStrategy: "set_model"`), иначе `none`.

Ограничение: `temperature` кладётся в `samplingParams` (pi применяет per-request
sampling-параметры, если провайдер поддерживает); гарантированно ограничивается
`maxTokens` через `Model.maxTokens`.

## Next phases (не сделано)

- `TaskProfile.complexity` wiring (Phase 2 — сделано через RoutingDecision).
- Flash LLM router (Phase 2 — см. `docs/FLASH_ROUTER.md`).
- GenerationEvaluator (extension decision).

## Калибровка (вход из observability)

`generation.budget` / `generation.extend*` / `generation.finish` (см.
`docs/OBSERVABILITY.md`) — вход для ручной или агентной калибровки `profiles.ts`:
какой профиль выставили (`complexity` + initial/soft/hard), применился ли
(`budgetApplied`/`budgetApplyStrategy`), расширяли ли (`extend` from→to),
отказ (`extend_denied` reason), не хватило ли токенов (`finish` truncated/length).
