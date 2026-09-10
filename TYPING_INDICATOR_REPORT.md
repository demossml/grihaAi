# TYPING_INDICATOR_REPORT.md

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **507/507 passed**
- turbo: `npx turbo run typecheck test build` — 16/16

## Что сделано
- `telegram-bot/typing-heartbeat.ts` — пульс `sendChatAction(typing)` с immediate-first-pulse,
  интервал 4000мс (инъектируемый для тестов), ошибки глотаются, `stop()` резолвится после выхода цикла.
- `TelegramBridge`: heartbeat запускается ТОЛЬКО после allow (gate.process && !suppressReply):
  не при pending/ACL/prefilter-block, не при archivist silent-archive. Обёрнуты ветки
  text / voice (STT+агент) / photo / document / contact / location; `finally` останавливает
  пульс при любой ошибке. Форум — тот же `message_thread_id`.
- Wiring: controller → `bot.api.sendChatAction(chatId, action, {message_thread_id})` (адаптер в index.ts).

## Tests
- `typing-heartbeat.test.ts` (5): immediate pulse; пульсация до stop; нет пульсов после stop;
  throw не роняет loop; messageThreadId прокидывается.
- `archivist-mode.test.ts` (3): silent → 0 вызовов; allow → typing до агента и остановка после;
  silent-archive → heartbeat не запускается.

## Manual checks
1. DM: вопрос → сразу «три точки» → ответ.
2. Долгий ответ → typing не гаснет через 5с (пульсирует).
3. Pending-группа → нет typing, нет ответа.
4. Forum topic → typing и ответ в той же теме.
