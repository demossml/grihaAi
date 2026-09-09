# TELEGRAM_GROUPS_REWRITE_REPORT.md

Полное ТЗ: GRIHA_TELEGRAM_GROUPS_REWRITE_TASK.md (реврайт работы с Telegram-чатами/группами).

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **458/458 passed**
- turbo: `npx turbo run typecheck test build` — 16/16 успешны

## Что сделано по ТЗ

### P0 — событие my_chat_member (первопричина)
- `toChatMemberEvent` теперь читает grammy-getter `ctx.myChatMember` (camelCase)
  с fallback на `ctx.update.my_chat_member` / плоское snake_case (совместимость
  с фейками). Раньше читалось только `ctx.my_chat_member`, которого в grammy-контексте
  нет → событие всегда отбрасывалось и онбординг не запускался никогда.
- `bot.on("my_chat_member")` логирует событие (old/new status, chat, actor), результат
  обработки и ошибки (FR-9); непарсируемый update — отдельный лог.

### Онбординг в группу (FR-2, FR-3, Риск A, Ограничение D)
- `onChatMemberAdded` отправляет меню с кнопками пресетов **в саму группу**
  (первым каналом — бот в группе не ограничен «первым /start»), затем в DM добавившему.
- Старый R3-фоллбэк «откройте личный чат…» удалён — полное меню в группе.
- Тишина до настройки сохранена по контенту (FR-5): pending-группа silent для LLM,
  но онбординг и `/setup` разрешены (согласовано с заказчиком).

### /setup в группе (FR-3)
- В группе `/setup` — только для этой группы (keyboard прямо в группу); не-pending →
  «Эта группа не ожидает настройки». В DM — без изменений (≤5 pending + `/setup <chatId>`).

### Права (FR-4, NFR-1)
- Применять пресет может creator/administrator группы (getChatMember, fail closed)
  **или** пользователь с ролью owner/admin в ACL бота (`canManage`). Не-админ без роли —
  отказ с alert, правила не меняются.

### Сервисные сообщения (FR-6)
- `new_chat_members` / `left_chat_member` / `new_chat_title` / `pinned_message` и др.
  отсекаются в контроллере ДО агента с отдельным логом «service message … ignored».

### Идемпотентность (FR-8)
- Повторный add при pending не дублирует онбординг-сообщение; completed/skipped — no-op.
- Пресеты (FR-7) — семантика не менялась: safe_default/team/secretary/listener/shop/
  only_me + custom/skip. Callback-ключи ≤64 байт (Риск C).

### Сохранено (NFR-2, NFR-4)
- ResilientFetcher/мульти-IP, retry_after/429, per-chat queue, session keys,
  caption_entities, STT, ACL callbacks, форумные message_thread_id — без регрессий.

## Files changed
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` — toChatMemberEvent (P0), логи, FR-6
- `apps/agent/.pi/extensions/chat-setup/handlers.ts` — онбординг в группу, /setup в группе, FR-8 дедуп
- `apps/agent/.pi/extensions/telegram-bot/chat-auth.ts` — FR-4 (групп-админ ИЛИ owner/admin бота)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` — комментарий /setup
- tests: `telegram.test.ts` (P0 parsing, FR-6), `chat-setup-service.test.ts` (онбординг/дедуп/FR-4),
  `telegram-setup-command.test.ts` (групповые сценарии), `chat-auth.test.ts` (FR-4)
- docs: `docs/TELEGRAM-BOT.md`, `STATUS.md` (Phase 27), `README.md`

## Definition of Done (п. 4.3 ТЗ)
1. ✅ Добавление бота → онбординг-сообщение с кнопками в группе (тест)
2. ✅ Пресет от администратора группы применяется (тест)
3. ✅ Не-администратор получает отказ (тест)
4. ✅ До пресета бот не отвечает на обычные сообщения/@mention (prefilter, регрессионные тесты)
5. ✅ /setup работает в группе (для админа/owner) и в DM (тесты)
6. ✅ Повторное добавление не спамит дублями (тест FR-8)
7. ✅ typecheck/build/тесты зелёные
8. ✅ Нет регрессий: личные чаты, форумные темы, документы, голос, сеть (регрессионный прогон)

## Manual checks (п. 8 ТЗ)
1. Добавить бота в группу `-5239797479` → в группе появляется меню пресетов
   (journalctl --user -u griha-ai: `my_chat_member: old=… new=… chat=… actor=…`).
2. `/setup` в группе от owner `5700958253` → keyboard; от обычного участника → отказ.
3. Пресет от администратора → правила применяются, бот отвечает по правилам.
4. Обычный текст в pending-группе → тишина.
5. Повторный кик+add → дублей онбординга нет.
