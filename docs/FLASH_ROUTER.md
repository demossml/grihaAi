# Flash Router (Phase 2)

Маршрутизация сообщения → `RoutingDecision` (role + complexity + kind), далее
complexity/kind идут в GenerationPolicy (`resolveGenerationBudget`, Phase 1).

## Flags

- `GRIHA_FLASH_ROUTER=1|true|yes` — включить LLM flash-маршрутизацию (default **OFF**).
- `GRIHA_GENERATION_POLICY=1` — как в Phase 1 (применение бюджета).
- Флаги независимы. Если flash on и policy on — complexity/kind берутся из decision.
- Оба OFF → поведение 1:1 с прежним (обязательные тесты).

## Rule table (детерминированный pre-route, без LLM)

| Условие | role | complexity | kind |
|---|---|---|---|
| hasImage / hostHint=ocr | vision | simple | vision_ocr |
| hostHint=report или ключевые слова отчёт/расход/итог/сумм/expenses/report | flash | trivial | report_dispatch |
| текст 1–40 символов | flash | trivial | chat_reply |
| hostHint=analysis или проанализируй/сравни/почему/динамика/анализ | main | complex | analysis |

Rule-решение с confidence ≥ 0.8 → Flash НЕ вызывается. Иначе (нет уверенного
rule) и `GRIHA_FLASH_ROUTER` on → LLM Flash; иначе fallback (`main`/medium).

## Что видит Flash

Только короткий `RoutingContext` (срез `userText` ≤ 1500): `userText`, `hasImage`,
`hasVoice`, `hostHint`, `chatType`. **Без** истории, **без** chat id, **без** ACL.

Flash **не решает** ACL / chatId / доступ к группам и **не считает** суммы
расходов (это report-data tools).

## Parse failure / low confidence

Ошибка парсинга JSON-ответа или confidence < 0.5 → `fallbackRoute` (`main`/medium,
`reason: flash_error` | `flash_low_confidence_or_parse`). Исключение в user-path
не пробрасывается.

## Map flash → model id

`resolveModelConfigForDecision`:
- vision → `models.vision` (throw если не сконфигурирован);
- flash → `models.flash` если задан, иначе main, но при provider `deepseek`
  подставляется `deepseek-v4-flash`;
- main → `models.main` → legacy top-level.

`toLegacyModelRole`: flash и main → `"main"`, vision → `"vision"`.

## API

- `tryRuleRoute(ctx)` / `fallbackRoute(ctx)` — чистые, без LLM.
- `parseFlashDecision(raw)` / `routeWithFlash(ctx, deps)` — Flash-ветка.
- `routeMessage(ctx, { env, callFlash })` — главный вход.
- `isFlashRouterEnabled(env)`.
- `resolveModelConfigForDecision(config, decision)` / `toLegacyModelRole(role)`.

## Wire

`ModelRouter.selectRoutingDecision(ctx, callFlash?)` и `ModelRouter.callWithDecision(decision, messages)`
— готовы для pool. Сбор `RoutingContext` и вызов в TelegramSessionPool — отдельная
точка (в этом этапе API + тесты готовы, pool-wire минимальный).

## TelegramSessionPool wire (Phase 2.1)

- `apps/agent/.pi/extensions/telegram-bot/pool-routing.ts`:
  `buildRoutingContext` + `preparePoolRouting` (чистые, тестируемые без grammy).
- Врезка в `TelegramSessionPool.runPrompt` перед `session.prompt`.
- **Flags off → ноль накладных**: `preparePoolRouting` возвращает `{ null, null }` сразу.
- **On**: `buildRoutingContext` → `routeMessage` → `resolveGenerationBudget`
  (complexity/kind из decision, только при `GRIHA_GENERATION_POLICY`).
- `userText` обрезается до 1500; история/JSONL не передаётся; ACL/chatId не решает router.
- **Fail-safe**: ошибка маршрутизации не роняет ход — prompt всё равно выполняется.
- **callFlash: НЕ wired** (pool не имеет прямого model caller) — при `GRIHA_FLASH_ROUTER`
  работает только rule-route + fallback (LLM-ветка не вызывается без callFlash).
- obs: событие `routing.decision` (role/complexity/kind/confidence/source/reason, без userText).

## Phase 2.2

- `apps/agent/.pi/extensions/telegram-bot/pool-call-flash.ts`:
  `createCallFlash` + `flashDepsFromConfig`. Endpoint `{baseUrl}/v1/chat/completions`,
  `deepseek-v4-flash` (или `config.models.flash`), `max_tokens: 256` (router output — только JSON),
  `temperature: 0.0`, timeout 8000ms (AbortController).
- apiKey из того же места, что bot/session (config), не хардкод. Если apiKey отсутствует —
  callFlash не создаётся → rule-route + fallback (без LLM).
- Budget apply (D2): `ModelRouter.callWithDecision` передаёт `GenerationParams`
  (`maxTokens = initialMaxTokens`, `temperature`) в `ModelCaller` при
  `GRIHA_GENERATION_POLICY=1`. Флаг off → `gen` undefined (1:1).
- `TelegramSessionPool` использует pi `session.prompt`, который НЕ принимает
  per-turn maxTokens/temperature (`PromptOptions`: expandPromptTemplates/images/
  streamingBehavior/source/preflightResult — agent-session.d.ts L148-164). Поэтому
  для Telegram-пути budget — obs (`routing.decision.budgetApplied/initialMaxTokens/
  policyVersion`), а реальное ограничение maxTokens применяется на уровне
  `ModelRouter` (runtime model-call абстракция) и flash-роутера (max_tokens 256).

## Phase 2.3

- Budget на prompt path: `TelegramSessionPool.runPrompt` применяет бюджет через
  `session.setModel(applyBudgetToModel(session.model, budget))` (STRATEGY B) при
  `GRIHA_GENERATION_POLICY=1` + non-null budget; restore в `finish`.
- `pool-apply-budget.ts` — `applyBudgetToModel` (клонирует pi `Model`:
  `maxTokens = initialMaxTokens`, `samplingParams.temperature = temperature`).
- obs: `routing.decision.budgetApplied` = true только при реальном `set_model`;
  добавлен `budgetApplyStrategy` ("set_model" | "none").

## Next (не сделано)

- Calibration auto-apply (Phase 3).
- Per-turn maxTokens в pi `session.prompt` (нужен official API в pi SDK).
