# OBSERVABILITY_V2_REPORT.md

## STATUS: VERIFIED

## PACKAGE changes (`packages/observability`)
- `types.ts` — `ObsEvent` += `threadId?`, `code?`.
- `obs.ts` — `EmitInput`/event += `threadId?`, `code?`.
- `query.ts` — `QueryFilter` += `code?`, `eventPrefix?` (event.startsWith).
- `redact.ts` — `SENSITIVE_KEY_RE` `token` → `token(?!s)`: счётчики `maxTokens`/`initialMaxTokens`/
  `softMaxTokens`/`hardMaxTokens`/`outputTokens`/`toMaxTokens` НЕ redact-ятся (это числа бюджета).
- `helpers.ts` (новый) — `emitTurnStart`, `emitTurnEnd`, `emitGenerationBudget`, `emitGenerationFinish`.
- `index.ts` — экспорт helpers.

## AGENT wire file:line
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` `runPrompt`:
  `turn.start` (после correlationId), `turn.end` + `generation.finish` (в `finish`),
  `routing.decision` + `generation.budget` (после `preparePoolRouting`).
- `apps/agent/src/runtime/generation/allocator-obs.ts` (новый) — `tryExtendBudgetWithObs`.
- `apps/agent/.pi/extensions/obs-tools/index.ts` — `obs_query` += `code`/`eventPrefix` + описание.

## generation.extend runtime wire: no
`tryExtendBudgetWithObs` готов (helper + тест), но multi-pass extend в prod runtime не вызывается
(Phase 3 calibration не начат). EXTEND_RUNTIME_WIRE: no (документировано).

## generation.finish usageAvailable: no
pi `session.prompt` не отдаёт usage/finishReason (проверено — `agent_end` не несёт usage;
`PromptOptions` без usage). `generation.finish` пишется с `code: "unknown"` и `data.usageAvailable: false`.
НЕ выдумываю outputTokens.

## correlationId e2e: yes
`turn.start` → … → `turn.end` используют один `correlationId` (`buildTelegramCorrelationId`),
прокинутый через `baseEvent`. Проверено тестом helpers (same correlationId).

## TESTS
- `packages/observability/src/helpers.test.ts` (2 новых) + существующие obs (9) — **11/11 pass**.
- `apps/agent/tests/unit/allocator-obs.test.ts` (2) — extend / extend_denied.
- Полный: `npx turbo run typecheck test build` — **40/40 successful**, `npm run lint` — **0 ошибок**.

## TYPECHECK/BUILD
`npx turbo run typecheck test build` — 40/40 successful.

## DOCS
- `docs/OBSERVABILITY.md` — v2 turn chain, event catalog, budget analysis, privacy.
- `STATUS.md` — Phase 46; `README.md` — секция Observability.
- `docs/GENERATION_POLICY.md` — «Калибровка (вход из observability)».
- `docs/FLASH_ROUTER.md` — «Observability» (routing.decision).

## CALIBRATION READINESS
| Question | Event |
|---|---|
| Budget applied? | `generation.budget.budgetApplied` + `budgetApplyStrategy` |
| Need more tokens? | `generation.finish` truncated/length + `generation.extend*` |
| Which profile? | `generation.budget` complexity, initial/soft/hard |
| Why silent? | `gate.block` reason |
| Which tools? | `tool.end` toolName |

## STOP
Нет auto-calibration. Нет сырого текста в jsonl (redact + только textLen/ocrLen/counts).
