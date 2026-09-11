# TELEGRAM-E2E-MATRIX — матрица сценариев Telegram layer

Автоматический прогон: `apps/agent/tests/unit/telegram-e2e-matrix.test.ts`
(tsx --test, 22 сценария; PASS ставится только по реальному выполнению теста).
Полный слой: bridge → policy (`evaluatePolicyFromRules`) → `processMedia`
(`ListenerMediaPipeline` + SQLite + `LocalMediaStorage` + mock STT).

## Таблица результатов (прогон 2026-09-11)

| Scenario | Expected | Actual | Test |
|---|---|---|---|
| private text | agent отвечает | PASS | `telegram-e2e-matrix.test.ts` |
| group listener photo | OCR+archive+expense, без агента | PASS | `telegram-e2e-matrix.test.ts` |
| group listener text | archive, без агента и ответа | PASS | `telegram-e2e-matrix.test.ts` |
| group listener document | archive, без агента | PASS | `telegram-e2e-matrix.test.ts` |
| group listener voice | STT+archive, без агента | PASS | `telegram-e2e-matrix.test.ts` |
| group listener @mention | агент с архивом | PASS | `telegram-e2e-matrix.test.ts` |
| group mention unauthorized | архив есть, агента НЕТ | PASS | `telegram-e2e-matrix.test.ts` |
| group reply authorized | агент | PASS | `telegram-e2e-matrix.test.ts` |
| group require_mention без mention | blocked, ничего | PASS | `telegram-e2e-matrix.test.ts` |
| pending group | полная тишина, без OCR | PASS | `telegram-e2e-matrix.test.ts` |
| channel_post text | archive, без агента | PASS | `telegram-e2e-matrix.test.ts` |
| channel_post photo | OCR+archive+expense | PASS | `telegram-e2e-matrix.test.ts` |
| channel_post document | archive | PASS | `telegram-e2e-matrix.test.ts` |
| channel_post voice | STT+archive | PASS | `telegram-e2e-matrix.test.ts` |
| channel_post caption | archive с caption | PASS | `telegram-e2e-matrix.test.ts` |
| topic photo (thread 10) | archive с thread_id | PASS | `telegram-e2e-matrix.test.ts` |
| duplicate photo ×3 | 1 архив, 1 файл, 1 expense | PASS | `telegram-e2e-matrix.test.ts` |
| photo + caption | caption отдельно от OCR | PASS | `telegram-e2e-matrix.test.ts` |
| edited_message | ревизия архива без дублей | PASS | `telegram-e2e-matrix.test.ts` |
| download error (ETIMEDOUT) | retry-джоб, агент с ошибкой живёт | PASS | `telegram-e2e-matrix.test.ts` |
| STT error | архив needsReview, файл сохранён | PASS | `telegram-e2e-matrix.test.ts` |
| Telegram 429 | retry-джоб (transient) | PASS | `telegram-e2e-matrix.test.ts` |

## Дополнительные покрытия (не в этой таблице)

- Топики A/B не смешиваются: sessionKey `tg:{uid}:{chat}:t:{thread}`
  (`telegram-session-key.test.ts`), archive/expense `thread_id`
  (`listener-media-pipeline.test.ts`, `thread-id.test.ts`).
- Crash recovery: `requeueStaleProcessing` + dead-letter
  (`retry-reliability.test.ts`).
- Security matrix: creator/admin/member/unknown/sender_chat ×
  read/archive/agent/rules-mutation (`security-matrix.test.ts`).
- Update routing `message|channel_post|edited_message|edited_channel_post`
  (`telegram-normalizer.test.ts`, `channel-updates.test.ts`).
- Storage: traversal/limits/mime/restart-persistence
  (`media-storage.test.ts`, `media-pipeline-persistence.test.ts`).

## Failure injection (fault matrix)

| Fault | Ожидание | Test |
|---|---|---|
| Telegram 429 | respect retry_after; retry-джоб | `telegram-e2e-matrix.test.ts`, `telegram-errors.test.ts` |
| Telegram timeout | retry-джоб, без потери file_id | `telegram-e2e-matrix.test.ts` |
| download error | retry-джоб | `telegram-e2e-matrix.test.ts` |
| OCR error | файл сохранён, archive needsReview | `media-pipeline-persistence.test.ts` |
| STT error | файл сохранён, needsReview | `telegram-e2e-matrix.test.ts` |
| SQLite busy | WAL + транзакции; атомарный дедуп | `retry-reliability.test.ts` |
| storage error | pipeline бросает; caller → retry | `telegram-e2e-matrix.test.ts` (download-ветка) |
| process restart | stale-processing requeue | `retry-reliability.test.ts` |

## Ограничения

- Живого Telegram API в CI нет: E2E строится на `TelegramBridge` + реальных
  SQLite/Storage с fake-скачиванием/STT. Реальный прогон — ручной E2E на боте.
- Coverage-отчёт для Telegram layer не добавлен (нет coverage-инструмента в
  проекте); ветки покрыты тестами по сценариям выше.

## Gaps G1–G11 (Telegram 100% for Grisha, 2026-09-11)

| Scenario | Expected | Actual | Test |
|---|---|---|---|
| album из 3 фото | 1 logical batch, ≤1 agent turn | PASS | `gaps-g1-g11.test.ts` |
| album разные group_id | отдельные flush'и | PASS | `gaps-g1-g11.test.ts` |
| OCR 3-й вызов при limit=2 | без vision, файл сохранён | PASS | `gaps-g1-g11.test.ts` |
| /start setup_-1001 в DM | setup для -1001 | PASS | `gaps-g1-g11.test.ts` |
| /start setup_* в группе | подсказка DM | PASS | `gaps-g1-g11.test.ts` |
| send_file kind=photo | sendPhoto с caption | PASS | `gaps-g1-g11.test.ts` |
| reply context | [REPLY_TO] в промпте | PASS | `gaps-g1-g11.test.ts` |
| audio → pipeline | storage + STT + архив kind=audio | PASS | `gaps-g1-g11.test.ts` |
| video → pipeline | storage + архив needsReview (без STT) | PASS | `gaps-g1-g11.test.ts` |
| video_note в normalizer | kind=video_note | PASS | `gaps-g1-g11.test.ts` |
| /pin на reply | pinHandler c messageId | PASS | `gaps-g1-g11.test.ts` |
| chat_join_request | уведомление владельцу (default) | PASS | `gaps-g1-g11.test.ts` |
| edited photo | ревизия архива (caption/revision), без дубля | PASS | `gaps-g1-g11.test.ts` |
