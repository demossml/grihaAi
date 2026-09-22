# FLASH_ROUTER_PHASE22_REPORT.md

## STATUS: VERIFIED

## D1 callFlash: wired YES
- `apps/agent/.pi/extensions/telegram-bot/pool-call-flash.ts` — `createCallFlash` + `flashDepsFromConfig`.
- Wire: `pool-routing.ts` `preparePoolRouting` → при `GRIHA_FLASH_ROUTER=1` + apiKey строит `callFlash`
  через `createCallFlash` и передаёт в `routeMessage` (source `flash_llm` возможен).
- apiKey берётся из config (`models.flash` → `models.main` → legacy top-level), не хардкод.
- Без apiKey → callFlash не создаётся → rule-route + fallback (без LLM).

## D2 budget apply: PARTIAL
- **Applied** в `ModelRouter.callWithDecision` (`apps/agent/src/utils/routing/model-router.ts`):
  при `GRIHA_GENERATION_POLICY=1` → `GenerationParams { maxTokens: initialMaxTokens, temperature }`
  передаётся в `ModelCaller` (3-й аргумент). Флаг off → `gen` undefined (1:1).
- **Telegram-путь obs-only**: `TelegramSessionPool` использует pi `session.prompt`, который
  НЕ принимает per-turn maxTokens/temperature.
  Доказательство: `agent-session.d.ts` L148-164 `PromptOptions` = { expandPromptTemplates, images,
  streamingBehavior, source, preflightResult } — нет maxTokens/temperature. `session.setModel`
  требует полный `Model<Api>` (не простой конфиг) — per-turn переключение модели рискованно.

## How maxTokens reaches provider
- Runtime `ModelRouter` → `ModelCaller(config, messages, gen)` — gen несёт maxTokens/temperature.
- Flash router → `createCallFlash` шлёт `max_tokens: 256, temperature: 0.0`.
- Telegram main generation → pi `session.prompt` (без per-turn maxTokens) — budget в obs.

## FLASH model id used
- `deepseek-v4-flash` (или `config.models.flash.model`), endpoint `{baseUrl}/v1/chat/completions`.

## TESTS
- `call-flash.test.ts` (3), `telegram-pool-routing.test.ts` (10), `budget-apply.test.ts` (2) — **15/15 pass**.
- Полный: `npx turbo run typecheck test build` — **40/40**, **1405 tests pass / 0 fail**.
- `npm run lint` — **0 ошибок**.

## TYPECHECK/BUILD
`npx turbo run typecheck test build` — 40/40 successful.

## DOCS
- `docs/FLASH_ROUTER.md` — секция «Phase 2.2».
- `docs/GENERATION_POLICY.md` — «Budget apply (Telegram pool)».
- `STATUS.md` — Phase 44; `README.md` — строка про Phase 2.2.

## FLAGS default OFF: confirmed
`GRIHA_FLASH_ROUTER` и `GRIHA_GENERATION_POLICY` — default OFF (1:1, тесты flag-off).

## STOP
Phase 3 (calibration) не начат. Secretary/prefilter/OCR не тронуты.
