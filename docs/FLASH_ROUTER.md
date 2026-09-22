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

## Next (не сделано)

- Calibration auto-apply (Phase 3).
