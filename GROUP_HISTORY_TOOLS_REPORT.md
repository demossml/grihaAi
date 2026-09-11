# Group History Tools + Quiet Expense Brief

Дата: 2026-09-11. Repo: grihaAi. Порядок работ §7 выполнен полностью.

## Что сделано

### 1. Repository (`DocumentsRepository.ts`)
- `listMessages(ArchiveListQuery)` — история чата: фильтры `threadId`, `beforeMessageId`
  (CAST по message_id), `kinds`, `fromDate`/`toDate` (inclusive), `ORDER BY created_at DESC,
  message_id DESC LIMIT ?`. Индексы `idx_archive_chat_msg/date` уже были.
- `listRecent({ chatIds, sinceIso, limit })` — события по списку чатов за окно.
- `topRecentChats(chatIds, limit)` — топ чатов по `MAX(created_at)` для group_recent (cap 10).
- `storageKey` подтягивается коррелированным подзапросом из `telegram_media`
  (0..1 строк на архив — без дублей при повторной доставке file_unique_id).
  `ChatArchiveRecord.storageKey?` добавлен (read-only enrichment, H4).

### 2. ACL (`groupHistoryTools.ts`)
- `assertCanReadChat(userId, chatId, deps)`: configured (completed|skipped) И
  (canManage ИЛИ isAllowed). H1–H3, H6: deny → «Чат не настроен или нет доступа.»
- `clampInt` (H5): history 1..100 (default 30), recent 1..50 (default 20),
  sinceHours 1..168 (default 24).

### 3. Tools (`.pi/extensions/group-memory/`)
- `group_history` + `group_recent` (TypeBox-схемы по спекам §2.1/§2.2).
- `formatArchiveItem` — компактный LLM-дружественный элемент: messageId, threadId, at,
  kind, fromUserId, text, ocrText (≤500, truncated), hasMedia, storageKey, expenseId.
  Без сырых путей/token'ов (H4). `kinds: ["other"]` → video_note/audio/expense.
- ctx.userId/chatId — из session context (как у expenses tools).
- В `SUB_SESSION_EXTENSIONS` (TelegramSessionPool) добавлены `documents`
  (expenses_sum/list теперь реально доступны в Telegram-субсессиях) и `groupMemory`.

### 4. Skill (`packages/skills/skills/core/SKILL.md`)
Секция «Group archive»: group_history / group_recent / expenses_* — никогда не
выдумывать историю, только результаты tools.

### 5. Quiet expense brief (§4, опционально)
- `ListenerMediaDeps.notifyExpenseBrief?: (info: ExpenseBriefInfo) => Promise<void>`
  вызывается ТОЛЬКО после успешного structured ingest И при наличии суммы
  (needsReview-only не уведомляется); сбой уведомления не ломает конвейер.
- `formatExpenseBrief` → «Чек: {supplier|без названия} — {total} {currency}, {docDate}».
- `setExpenseBriefNotifier` в documents/index (deps по ссылке — без пересоздания pipeline).
- `TelegramBotController.sendNotify` — текущий bot + per-chat очередь + retry, plain.
- `wireExpenseBriefNotify` в telegram-bot/index: отправка только при правиле
  `notify_expense_brief=true` в чате; получатель — `addedByUserId` настройки чата
  или owner бота (DM). В группу не спамим (флага in-group нет).
- `RuleKey` дополнен `notify_expense_brief`.

## Тесты (`tests/unit/group-history-tools.test.ts`, 14 шт.)

1. not configured → false
2. configured + isAllowed → true
3. configured + not allowed + not canManage → false
4. history: mapped items (текст + медиа со storageKey/expenseId)
5. limit clamp (1000→100, 0→1) + handler на лимитах
6. recent без chatId: только доступные чаты; canManage — все configured; окно sinceHours
7. expense brief: supplier+total, без file_id; «без названия» при пустом supplier
+ H4: formatArchiveItem не отдаёт внутренние id/path, длинный OCR обрезан.

## Проверки
- 678 unit-тестов зелёные (было 664), `turbo typecheck` 10/10, `turbo build` 6/6.

## Acceptance
- ✅ owner в DM читает историю configured-группы по chatId → строки архива
- ✅ чужой пользователь без доступа → deny
- ✅ не configured чат → deny
- ✅ expenses tools по-прежнему работают (и теперь в Telegram-субсессиях)
- ✅ listener OCR не тронут (регресс-тесты зелёные)

## Out of scope (соблюдено)
Без FTS, без пуша всех сообщений владельцу, без обхода configured-gate (admin debug
flag не делался), prefilter/mention не менялись.
