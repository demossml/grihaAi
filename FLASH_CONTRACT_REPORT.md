# FLASH_CONTRACT_REPORT.md

## STATUS: VERIFIED

## Изменённые файлы
- `apps/agent/src/runtime/routing/rule-route.ts` — keywords расширены (`закупк`/`total`/`analysis`/`compare`/`why`);
  матчинг через `includes` (stems); analysis проверяется ПЕРЕД report (чтобы «почему выросли расходы» → analysis).
- `apps/agent/src/runtime/routing/flash-route.ts` — `FLASH_ROUTER_SYSTEM` обновлён (purchases/totals/sums, «NEVER invent money amounts»).
- `apps/agent/.pi/extensions/telegram-bot/pool-routing.ts` — `REPORT_DISPATCH_GUIDANCE` + `applyRouteGuidance`.
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` — guidance в `promptMessage` перед `session.prompt`.
- `apps/agent/tests/unit/routing/flash-contract.test.ts` (новый) — 5 тестов.
- `docs/FLASH_ROUTER.md` — «Usage contract». `STATUS.md` — строка Phase.

## Тесты
- `flash-contract.test.ts` — **5/5 pass**.
- routing suite — 47 pass / 0 fail.
- `npx turbo run typecheck test build` — **40/40 successful**; `npm run lint` — **0 ошибок**.

## Как включить флаги
```
export GRIHA_FLASH_ROUTER=1
export GRIHA_GENERATION_POLICY=1
```
(default OFF, 1:1 без флагов).

## Примеры
- «закупки за неделю» → kind=`report_dispatch`, role=`flash`
- «почему выросли» → kind=`analysis`, role=`main`
- фото → role=`vision`, kind=`vision_ocr`

## STOP
Runtime-механика budget (setModel/restore) не тронута. Phase 3 auto-calibration не начат.
