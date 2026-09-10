# LISTEN_ONLY_OCR_REPORT

## Summary
- Overall: **GREEN**
- typecheck: `npx tsc -p tsconfig.json --noEmit` — 0 ошибок
- tests: `npx tsx --test "tests/unit/**/*.test.ts"` — **512/512 passed**
- turbo: `npx turbo run typecheck test build` — 16/16

## listen_only + mention behavior (prefilter change)
- `evaluatePreFilter` (listen_only): без `botMentioned || repliedToBot` → `{process:false, suppressReply:true, archive:true(isGroup)}` — агент НЕ вызывается (L1), фоновая архивация разрешена.
- С обращением → `{process:true, suppressReply:false, archive:...}` — «слушатель» отвечает на редкие вопросы.
- Тесты: rule-presets.test.ts (4 новых сценария), group-configured-prefilter.test.ts.

## Pipeline files / entrypoints
- `src/services/documents/ListenerMediaPipeline.ts` (новый): `ListenerMediaPipeline.process(input, opts)`
  — resolve → download → extractor.extract → chat_archive (raw+rawText+confidence+ocr_status+expense_id)
  → expense_documents при распознанных полях и `ocrIngest` (дедуп file_unique_id, thread_id). Одно скачивание.
- `index.ts archiveHandler`: text → archiveFromTelegram; photo/document → полный pipeline
  (archive=true, ocrIngest = listen_only || archive_ocr_ingest); notify — только по `notify_poor_ocr`.
- Retry-хук: catch → `mediaRetry.enqueue` (file_id не теряется).
- Синглтон: `getListenerMediaPipeline()` (documents/index.ts).

## Preset listener keys
- `listen_only=true`, `archive_media=true`, `archive_ocr_ingest=true`, `require_mention=true`,
  `reply_to_bot=true` (было false), `notify_poor_ocr=false`; добавлены в `MANAGED_RULE_KEYS`.

## Migration of existing listener chats
- `bootstrapUsers` (telegram-bot/index.ts): для completed-чатов с `presetId==="listener"` —
  `replaceChatManagedRules` полным новым сетом (идемпотентно; чужие custom не трогаются).

## Retry worker uses full OCR pipeline? YES
- Worker `processJob` → `processMediaRetryJob(job, getListenerMediaPipeline())` —
  на ретрае выполняется download → OCR → archive → structured ingest (L6).

## Tests: 512 pass / 0 fail
- Новые: `listener-media-pipeline.test.ts` — expense+archive при полях; пустой extractor → archive с needsReview без expense; дедуп file_unique_id; download throw → проброс (caller retry); worker вызывает pipeline.process.
- Обновлены: rule-presets/group-configured (listen_only+mention семантика).

## Manual E2E
1. Listener-группа, фото без @ → тишина; строка в `chat_archive` (raw_text/ocr_status) и, при полях, в `expense_documents`.
2. `@bot вопрос` → ответ по правилам (heartbeat + reply).
3. Оборвать сеть при фото → job в `media-retry.sqlite` → после восстановления полный OCR-конвейер.
4. Pending-группа → полная тишина (L5).
