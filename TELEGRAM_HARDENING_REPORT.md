# Telegram Hardening P0+P1 — Full Fix Report

Дата: 2026-02 (завершение патча)
Статус: **GREEN**

## Summary

- **typecheck**: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок (apps/agent + все workspace-пакеты).
- **turbo**: `npx turbo run typecheck test build` — 16/16 задач успешны.
- **Tests**: `npx tsx --test "tests/unit/**/*.test.ts"` — **420/420 passed**, 0 failed.
- Не сломаны инварианты предыдущих патчей: silent-until-configured (R1–R8), forum-topic
  `message_thread_id`, изоляция сессий, групповой онбординг (pending = молчание).
- Webhook (P2) не делался; контроллер не переписывался с нуля — только точечные правки.

## Fixed defects

| # | Дефект | Решение |
|---|--------|---------|
| D1 | `caption_entities` не учитывались при определении @упоминания бота (только `entities`) | `mentions.ts`: `collectMentionFlags` по text+caption, `mergeMentionFlags` (ИЛИ); pre-filter видит `botMentioned`/`startsWithOtherMention` с подписи фото/документа |
| D2 | Сессия была одна на пользователя — один user в двух группах путал контекст | `session-key.ts`: `buildTelegramSessionKey({userId, chatId?, threadId?})` → `tg:{uid}:{chat}[:t:{threadId}]`; сквозной ключ в bridge/pool/директориях; `/new` сбрасывает один ключ |
| D3 | Голосовые сообщения игнорировались (не было STT) | DM: `transcribeVoice` из `@griha/stt`; `stt-unavailable` (нет опции) / `stt-failed` (ошибка) / `stt-empty` (пусто); temp-файл удаляется в finally; агенту — текст |
| D4 | Callback-кнопки не проходили ACL (только whitelist allowedUserIds) | `handleCallbackQuery`: `options.aclCheck(userId, chatId)` (UsersService) с legacy-fallback |
| D5 | `/setup` в группе/без аргументов работал неполноценно | Только в DM; `/setup <chatId>` → один keyboard; пусто → до 5 keyboard'ов по pending |
| D6 | `getMe` не вызывался при создании бота | `pollLoop`: getMe с try/catch-логом перед каждым bot instance |
| D7 | Невалидный HTML-ответ терялся полностью | После неудачного HTML-ретрая — один plain-text фолбэк того же чанка (без parseMode, без ретраев) |
| D8 | chat-setup.json читался только при старте | `ChatSetupService.loadSync(force)/reload()` |
| D9 | `/start` не напоминал о ненастроенных группах | `/start` в DM добавляет `pendingGroupsHint` («Есть группы без настройки: N…») |
| D10 | Отсутствовали регрессионные тесты под D1–D9 | Новые/обновлённые unit-тесты (mention, session-key, setup-command, voice, callback ACL, plain-fallback, /start hint) |

## Files changed

Runtime:
- `apps/agent/.pi/extensions/telegram-bot/mentions.ts` (новый, D1)
- `apps/agent/.pi/extensions/telegram-bot/session-key.ts` (новый, D2)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` (D1, D4, D6, D7)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` (D2, D3, D5, D9)
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` (D2)
- `apps/agent/.pi/extensions/telegram-bot/index.ts` (D2, D3, D5, D9)
- `apps/agent/.pi/extensions/telegram-bot/chat-setup/handlers.ts` (D5)
- `apps/agent/.pi/extensions/telegram-bot/chat-setup/ChatSetupService.ts` (D8)

Tests:
- `tests/unit/telegram.test.ts`, `tests/unit/telegram-reset.test.ts`, `tests/unit/telegram-reconnect.test.ts` (обновлены)
- `tests/unit/telegram-mention.test.ts`, `tests/unit/telegram-session-key.test.ts`, `tests/unit/telegram-setup-command.test.ts` (новые)

Docs:
- `docs/TELEGRAM-BOT.md` (раздел «Hardening P0+P1 (D1–D10)»), `STATUS.md` (Phase 25), `README.md`

## Manual E2E checklist

1. `/start` в DM → ответ с подсказкой про pending-группы.
2. Добавить бота в группу → в группе **тишина**, добавившему в DM приходят кнопки настройки.
3. `/setup` в DM → кнопки повторно; `/setup <chatId>` → одна клавиатура для конкретной группы.
4. Фото с caption `@бот …` в настроенной группе → бот отвечает (caption_entities обработаны).
5. Голосовое в DM → распознанный текст в ответе (при включённом STT).
6. Сообщения в двух разных группах → контексты не смешиваются (`tg:uid:chatId` изолированы).
7. Форум: ответ в тему — `message_thread_id` совпадает с входящим.
8. Ответ со сломанным HTML → приходит plain-text чанк (ответ не теряется).
9. Callback пресета от чужого пользователя → отклонён (ACL).
