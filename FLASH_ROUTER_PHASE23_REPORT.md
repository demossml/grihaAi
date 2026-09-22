# FLASH_ROUTER_PHASE23_REPORT.md

## STATUS: VERIFIED

## PI API table (§2)

| API | file:line | can set maxTokens per prompt? | can set temperature? |
|---|---|---|---|
| `PromptOptions` | `@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts` L148-164 | no | no |
| `AgentSession.prompt()` | `agent-session.d.ts` L359 | no (options: expandPromptTemplates/images/streamingBehavior/source/preflightResult) | no |
| `AgentSession.setModel()` | `agent-session.d.ts` L453 | **yes** (через `Model.maxTokens`) | partial (через `Model.samplingParams`) |
| `AgentSession.model` (getter) | `agent-session.d.ts` L291 | — | — |
| `Model.maxTokens` | `@earendil-works/pi-ai/dist/types.d.ts` L716-733 | yes (model-level default output tokens) | — |
| `Model.samplingParams` | `types.d.ts` L733 | — | yes (per-model default sampling, per-request keys override) |

## STRATEGY used: B (`set_model`)
`session.prompt` не принимает per-prompt maxTokens/temperature → применяем через
`session.setModel(applyBudgetToModel(session.model, budget))` перед prompt + restore в `finish`.
Pool очередь per-sessionKey (сериализована) → нет concurrent turns на одной session → безопасно.

## budgetApplied true means
`budgetApplyStrategy === "set_model"` — т.е. `session.setModel` реально вызван с моделью,
у которой `maxTokens = budget.initialMaxTokens` (и `samplingParams.temperature`). Не просто budget non-null.

## file:line apply
- `apps/agent/.pi/extensions/telegram-bot/pool-apply-budget.ts` — `applyBudgetToModel`.
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` `runPrompt` — setModel apply + restore в `finish`.

## flash model switch on prompt: no
Не переключаю model id на deepseek-v4-flash в `runPrompt` (рискованно). Применяю budget tokens
на текущей model (промпт §5 «хотя бы budget tokens»). Flash model id используется только в
`createCallFlash` (router), не в generation prompt.

## TESTS
- `pool-apply-budget.test.ts` — **3/3 pass** (maxTokens === initialMaxTokens, temperature в samplingParams, без мутации).
- Полный: `npx turbo run typecheck test build` — **40/40 successful** (1408 tests), `npm run lint` — **0 ошибок**.

## TYPECHECK/BUILD
`npx turbo run typecheck test build` — 40/40 successful.

## DOCS
- `docs/GENERATION_POLICY.md` — «Telegram / pi apply (Phase 2.3)».
- `docs/FLASH_ROUTER.md` — «Phase 2.3».
- `STATUS.md` — Phase 45.

## EVIDENCE (max_tokens → provider)
`applyBudgetToModel` возвращает `Model` с `maxTokens = initialMaxTokens` (тест assert).
Эта модель передаётся в `session.setModel`. pi использует `Model.maxTokens` как лимит output tokens
запроса: `@earendil-works/pi-ai` `adjustMaxTokensForThinking(baseMaxTokens, modelMaxTokens, ...)`
(`api/simple-options.d.ts`) берёт `modelMaxTokens` из модели — то есть `maxTokens` модели прямо
ограничивает `max_tokens` исходящего запроса. `temperature` — через `Model.samplingParams`.

## FLAGS default OFF: confirmed
`GRIHA_FLASH_ROUTER` / `GRIHA_GENERATION_POLICY` — default OFF (1:1, fail-safe).

## STOP
Phase 3 (calibration) не начат. prefilter/secretary/OCR не тронуты.
