# TELEGRAM_GROUPS_REWRITE_REPORT.md

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **452/452 passed**
- turbo: `npx turbo run typecheck test build` — 16/16 успешны

## Что изменилось (по фрагменту ТЗ GRIHA_TELEGRAM_GROUPS_REWRITE_TASK.md)

### Риск A — онбординг в группе
- `onChatMemberAdded`: сообщение с кнопками пресетов теперь уходит **в саму группу**
  (бот в группе не ограничен «первым /start», в отличие от DM), затем — в DM добавившему.
- Старый R3-фоллбэк «откройте личный чат… /setup» удалён — вместо него полное меню в группе.

### Ограничение D — тишина по контенту, онбординг разрешён
- Pending-группа по-прежнему silent для LLM-контента (R1 prefilter → false, 0 токенов).
- Разрешено (согласовано с заказчиком): онбординг-сообщение при добавлении и `/setup` в группе.
- `/setup` в группе — только для ЭТОЙ группы, только от creator/administrator
  (getChatMember, Пакет B); не-pending → «Эта группа не ожидает настройки».
  `/setup` в DM — без изменений (≤5 pending keyboard, `/setup <chatId>` с проверкой прав).

### Риск B — права через getChatMember
- Уже реализовано в предыдущем патче (Пакет B): `assertCanConfigureGroup` (strict
  creator/administrator), fail closed при сетевом сбое, 400/403 → «нет прав».
- Боту достаточно статуса member для чтения статусов — ограничений на API нет.

### Риск C — лимит callback_data
- Ключи `cs:{chatId}:{p:{preset}|custom|skip|confirm|cancel}` — ≤ 30 байт для
  реальных chatId (например, `-5239797479`), лимит 64 байт соблюдён (тесты кнопок это фиксируют).

## Files changed
- `apps/agent/.pi/extensions/chat-setup/handlers.ts` — онбординг в группу + `/setup` в группе
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` — комментарий /setup
- tests: `chat-setup-service.test.ts`, `telegram-setup-command.test.ts` — новые сценарии групп
- docs: `docs/TELEGRAM-BOT.md`, `STATUS.md` (Phase 27), `README.md`

## Test summary
- Онбординг: группа получает меню с кнопками (первым) + DM актору; повторный add не спамит;
  DM упал → онбординг всё равно в группе.
- `/setup` в группе: admin → keyboard в эту группу; non-admin → отказ; не-pending → отказ;
  DM-сценарии (≤5 keyboard, `<chatId>`, canManage) — без изменений.
- Регрессии: pending silent (prefilter), callback ACL + admin-статус, caption_entities,
  session keys, STT, forum threads, retry/queue — все зелёные.

## Manual checks
1. Добавить бота в тестовую группу `-5239797479` → в группе появляется меню пресетов
   (без предварительного /start от пользователя).
2. `/setup` в этой группе от owner `5700958253` → keyboard; от обычного участника → отказ.
3. Кликнуть пресет от администратора группы → правила применяются.
4. Написать обычный текст в pending-группу → тишина (LLM не отвечает).
