# FLASH_ROUTER_PHASE21_REPORT.md

## STATUS: VERIFIED

## READ file:lines
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` — `handleMessage` (L266), `runPrompt` (L293+), `session.prompt` (в runPrompt).
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` — `GrishaAgent` input (L113), 6 вызовов `this.agent({...})` (L1065/1106/1134/1176/1291/1423).
- `apps/agent/.pi/extensions/telegram-bot/index.ts` — `grishaAgent()` → `pool.handleMessage` (L250).
- `apps/agent/src/runtime/routing/*` — `routeMessage`, `isFlashRouterEnabled`.
- `apps/agent/src/runtime/generation/*` — `resolveGenerationBudget`, `isGenerationPolicyEnabled`.

## WIRE file:function
- `TelegramSessionPool.runPrompt` — вызов `preparePoolRouting({ text, hasImage, hasVoice, chatType }, { env })` перед `session.prompt`, в try/catch (fail-safe).
- `TelegramBridge` + `index.ts` — `hasImage`/`hasVoice`/`chatType` прокинуты через `GrishaAgent` input → `TelegramSessionMeta` → `runPrompt`.

## callFlash wired: no
Pool не имеет прямого model caller (модель бутстрапится в sub-session через `applyConfig`).
При `GRIHA_FLASH_ROUTER=1` работает rule-route + fallback; LLM-ветка не вызывается без callFlash.

## budget applied to model: obs-only
`session.prompt` не принимает maxTokens/temperature → budget логируется (`console.debug`) и не применяется. Допустимо по промпту (§5 DECISION).

## preparePoolRouting extracted: yes
`apps/agent/.pi/extensions/telegram-bot/pool-routing.ts` — `buildRoutingContext` + `preparePoolRouting` (чистые, без grammy).

## TESTS
- `npx tsx --test apps/agent/tests/unit/telegram-pool-routing.test.ts` — **7 passed / 0 failed**.
- Полный гейт: `npx turbo run typecheck test build` — **40/40**, **1397 tests pass / 0 fail** (включая regress telegram-тестов).
- `npm run lint` — **0 ошибок**.

## TYPECHECK/BUILD
`npx turbo run typecheck test build` — 40/40 successful.

## DOCS
- `docs/FLASH_ROUTER.md` — секция «TelegramSessionPool wire (Phase 2.1)».
- `STATUS.md` — Phase 43.
- `README.md` — строка про pool-wire.

## BEHAVIOR
| Flags | Behavior |
|---|---|
| both off | legacy 1:1 (preparePoolRouting → null/null сразу, ноль накладных) |
| policy on | budget from decision.complexity (obs-only) |
| flash on | routeMessage → rule-route + fallback (callFlash не wired) |
| route throws | prompt всё равно выполняется (fail-safe) |

## STOP
Флаги не включены по умолчанию. Phase 3 (calibration) не начат.
