# Group Onboarding Fix Report

## Summary
- Overall: **GREEN**
- typecheck: **PASS** (`npx turbo run typecheck` — 10/10 tasks)
- tests: **396 passed, 0 failed** (`tsx --test tests/unit/**/*.test.ts` в apps/agent)
- build: PASS (`npx turbo run build` — 16/16 tasks)

## Code changes
- `apps/agent/.pi/extensions/chat-setup/ChatSetupService.ts` — `loadSync()` (hydrate cache) + `isConfiguredSync(chatId)` (R1/R5)
- `apps/agent/.pi/extensions/user-rules/prefilter.ts` — `RulePreFilterInput.groupConfigured` + R1/R6-проверка первой строкой `shouldProcessMessage`
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` — `TgMessage.groupConfigured`, передача в prefilter (`?? false` для групп), gate инжеста документов в pending-группе
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` — option `getGroupConfigured`, заполнение `groupConfigured` в `toTgUpdate` (boolean для group/supergroup, undefined для private)
- `apps/agent/.pi/extensions/telegram-bot/index.ts` — wiring `getGroupConfigured` → `setup.isConfiguredSync`, `loadSync()` в bootstrap
- `apps/agent/.pi/extensions/chat-setup/handlers.ts` — DM-only меню; fallback в группу ровно один раз, фиксированный текст без кнопок (R3)
- `apps/agent/.pi/extensions/chat-setup/README.md` — contract (создан)
- `docs/TELEGRAM-BOT.md`, `README.md`, `STATUS.md` — обновлены

## Behavior checklist
- [x] pending group silent (R1: prefilter → false, даже на @mention)
- [x] DM onboarding attempted (R2)
- [x] single fallback only on DM failure, fixed text, no preset buttons (R3)
- [x] safe_default applied silently, status remains pending (R4)
- [x] completed/skipped allows prefilter rules (R5)
- [x] private unaffected (R6)
- [x] preset callbacks only from DM / canManage / addedBy (R7)
- [x] no LLM replies in pending group (R8)
- [x] docs updated

## Test results
```
npx tsx --test "tests/unit/**/*.test.ts"
ℹ tests 396
ℹ pass 396
ℹ fail 0
```
Новые кейсы: `tests/unit/group-configured-prefilter.test.ts` (6 prefilter-кейсов +
3 bridge-интеграции), расширены `chat-setup-service.test.ts` (isConfiguredSync 5 кейсов,
DM-fallback ровно один), `rule-presets.test.ts` и `telegram.test.ts` зелёные без регрессий.

## How to verify manually
1. Напишите боту /start в ЛС.
2. Добавьте бота в группу.
3. Ожидается: в группе НЕТ chatter от ассистента (тишина, даже на @mention).
4. Ожидается: DM с кнопками пресетов.
5. Нажмите пресет → в группе бот отвечает только по выбранным правилам (по умолчанию — @mention/reply).
