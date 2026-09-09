# ARCHIVIST_MODE_REPORT.md

ТЗ: Режим «Слушатель-архивариус» — сбор и сохранение всех сообщений и медиа группы.

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **483/483 passed**
- turbo: `npx turbo run typecheck test build` — 16/16 успешны

## Решения по открытым вопросам (п. 8 ТЗ)
1. Текстовые сообщения тоже архивируются (по спеке 3.2/приёмке п.2).
2. Reply на сообщение бота НЕ считается обращением — ответ только на явный `@mention`.
3. Новая таблица `chat_archive` (единый лог группы); `expense_documents` остаётся для финансов,
   распознанные чеки пишутся в обе таблицы (одно скачивание).
4. Сырой OCR-текст хранится как есть + флаги (`needs_review`/`confidence`); похожие на чеки
   дополнительно проходят expense-путь.

## Что сделано

### Разделение «чтения» и «ответа» (Вариант A)
- `user-rules/prefilter.ts`: `evaluatePreFilter` → `{process, suppressReply, archive}`.
  При `listen_only: true` сообщение обрабатывается (агент + архив), `suppressReply` —
  без `@mention`; игнор ботов/сервисных сохранён; `require_mention`/`ignore_if_other_mention`
  не блокируют обработку в режиме архива. `shouldProcessMessage` — совместимая обёртка.
- `TelegramBridge.ts`: `RulePreFilter` принимает boolean ИЛИ outcome; ветки text/photo/document
  в режиме архива: `beforeAgent` (индикатор «печатает…») → тихий архив → агент → подавление
  ответа (`archived-silent`). Обычный путь (ingest чеков → ack → prefilter → агент) не изменён.

### Архив всех сообщений и медиа
- `DocumentsRepository.ts`: таблица `chat_archive` (chat_id, thread_id, message_id,
  from_user_id, kind, doc_date, supplier, total, currency, raw_text, file_id/file_unique_id,
  file_name, mime_type, items_json, confidence, needs_review, created_at) + индексы и методы
  `insertArchive`/`findArchiveByMessageId`/`findArchiveByFileUniqueId`/`countArchive`.
- `chat-archive.ts` (новый): `ChatArchiveService` — `archiveText` (дедуп по chat+message_id),
  `archiveMedia` (скачать → extract/OCR → дедуп по chat+file_unique_id; любой документ
  архивируется, не только чеки; распознанный чек → kind=expense + запись в expense_documents);
  `archiveFromTelegram` — точка входа из bridge.
- `telegram-bot/index.ts`: `prefilter` → `evaluatePreFilter`; `archiveHandler` — тихий архив
  с download через telegram file API и temp-очисткой.

### Индикатор «печатает…»
- `beforeAgent` (`sendChatAction typing`) теперь вызывается сразу после приёма и до архива
  для всех обрабатываемых сообщений, включая тихие режимы без ответа.

## Критерии приёмки (п. 5 ТЗ)
1. ✅ Без @mention бот не пишет в группу (тест `archived-silent`).
2. ✅ Все текстовые сообщения сохраняются (тест archiveText + bridge text).
3. ✅ Фото/документы проходят extract, текст и поля сохраняются (тесты archiveMedia).
4. ✅ Дедуп: медиа по file_unique_id, текст по chat+message_id (тесты).
5. ✅ При @mention — обычный ответ (тест).
6. ✅ Пресеты team/secretary/shop/only_me/safe_default не изменены (регрессионные тесты).
7. ✅ Unit-тесты: prefilter (5 новых), bridge-архив (5), сервис архива (4).

## Files changed
- `apps/agent/.pi/extensions/user-rules/prefilter.ts`
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts`
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` (archiveHandler)
- `apps/agent/.pi/extensions/telegram-bot/index.ts`
- `apps/agent/.pi/extensions/chat-setup/RulePresets.ts` (описание listener)
- `apps/agent/src/services/documents/DocumentsRepository.ts`
- `apps/agent/src/services/documents/chat-archive.ts` (новый)
- `apps/agent/src/services/documents/index.ts`
- tests: `archivist-mode.test.ts` (новый), `rule-presets.test.ts`, `group-configured-prefilter.test.ts`
- docs: `docs/TELEGRAM-BOT.md`, `STATUS.md` (Phase 29)

## Ограничения / недоделки
- OCR — текущий `StubExtractor` (caption-парсинг, честный `needsReview`); Vision-экстрактор — будущая работа.
- Голосовые/видео в архив не пишутся (вне скоупа по ТЗ).
- Ответы на произвольные запросы по архиву без явной команды — вне скоупа.
