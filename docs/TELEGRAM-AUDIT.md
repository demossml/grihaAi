# TELEGRAM-AUDIT — фактический аудит Telegram-слоя

Дата: 2026-09-11. Источник истины — код (`apps/agent/.pi/extensions/telegram-bot`,
`apps/agent/.pi/extensions/user-rules`, `apps/agent/.pi/extensions/chat-setup`,
`apps/agent/src/services/documents`, `apps/agent/src/utils/telegram`) и тесты
(`apps/agent/tests/unit`), а не статус-доки.

## Метод

1. Точки входа: `TelegramBotController.pollLoop` — `bot.on("message")`,
   `bot.on("callback_query:data")`, `bot.on("my_chat_member")`. Реальные
   grammy-фильтры — в `realBotFactory` (`telegram-bot/index.ts`).
2. Путь update: controller (`toTgUpdate`) → `TelegramBridge.handleUpdate` →
   `evaluateInput` (`prepareGroupTurn`/prefilter) → archive/processMedia →
   agent → `sendReply`.
3. Базовые команды: `npm test` (536 unit), `npm run typecheck`, `npm run build`
   — зелёные на момент аудита.

## Ответы на критические вопросы

| # | Вопрос | Факт |
|---|--------|------|
| 1 | `channel_post` доходит до pipeline? | **НЕТ** — handler не зарегистрирован |
| 2 | Listener архивирует сообщение участника без agent ACL? | **НЕТ** — ACL раньше archive |
| 3 | Listener обрабатывает voice? | **НЕТ** — voice ветка без archive |
| 4 | Media-файл сохраняется после обработки? | **НЕТ** — удаляется из /tmp |
| 5 | photo/document/voice в topic? | photo/document да; voice — нет (не архивируется) |
| 6 | Channel media? | **НЕТ** (channel_post не обрабатывается) |
| 7 | Captions работают? | Да (`caption_entities`, caption в extractor) |
| 8 | Idempotency при повторном update? | Текст/медиа/expense — да (дедуп), но insert не атомарен |
| 9 | Падение Telegram API? | reconnect loop + sendWithRetry; download → media-retry |
| 10 | `retry_after`? | Да — `sendWithRetry` (тесты), download — через retry queue |
| 11 | Недоступность OCR/STT? | OCR → needsReview; STT → сообщение об ошибке |
| 12 | После рестарта процесса? | media-retry durable, но jobs застревают в `processing` |
| 13 | edited message/channel post? | **НЕТ** — молча теряются |
| 14 | Sender в channel post? | `from` отсутствует; `sender_chat` не моделируется |
| 15 | Unauthorized user меняет rules? | **ДА, может** — `/rules` без admin-проверки |
| 16 | Pending chat вызывает agent? | Нет (R-GR-1, блокируется) |
| 17 | Listener вызывает LLM? | Нет (process=false без mention; archive без LLM) |
| 18 | Темы смешиваются? | Нет (`tg:{uid}:{chat}:t:{thread}`, thread_id в БД) |
| 19 | Чаты смешиваются? | Нет (ключи chat_id, sessionKey) |
| 20 | Race при одновременных media updates? | Дедуп `find+insert` не атомарен — возможен дубль |

## Подтверждённые дефекты

| ID | Дефект | Файл / функция | Статус |
|----|--------|----------------|--------|
| D1 | `channel_post`, `edited_message`, `edited_channel_post` не маршрутизируются: зарегистрирован только `bot.on("message")`, `toTgUpdate` читает только `ctx.message` | `TelegramBotController.pollLoop`, `toTgUpdate` | исправлено (02) |
| D2 | Early ACL блокирует listener-архив: `aclCheck` выполняется ДО prefilter/archive — участник без agent-ACL не архивируется даже в `listen_only` | `TelegramBridge.handleUpdate` | исправлено (03) |
| D3 | Voice не архивируется в listener: ветка `msg.voice` уходит в `blocked-by-rules` без archive; `processMedia` принимает только photo/document | `TelegramBridge.handleUpdate`, `telegram-bot/index.ts` | исправлено (04) |
| D4 | Медиа-файлы удаляются после обработки: `fs.rm(tempPath)` в finally; постоянного хранилища нет | `ListenerMediaPipeline.process`, `DocumentIngestService`, `index.ts` (transcribeVoice) | исправлено (05) |
| D5 | Retry-джобы застревают в `processing` после crash: `claimDue` берёт только `pending` | `media-retry.ts` | исправлено (07) |
| D6 | `/rules` меняет правила без admin-проверки (любой ACL-user; API error не проверяется) | `user-rules/commands.ts` (`runRulesCommand`) | исправлено (08) |
| D7 | Sender channel post не моделируется: `from` может отсутствовать, `sender_chat` не читается, bridge вернёт `no-user` | `toTgUpdate`, `TelegramBridge.handleUpdate` | исправлено (02) |
| D8 | Edited-сообщения теряются; нет версионности правок | controller/bridge | исправлено (02) |
| D9 | Дедуп не атомарен: `findByFileUniqueId` + `insert` без UNIQUE — race при дубль-доставке | `DocumentsRepository` | исправлено (07) |
| D10 | STT-confidence не используется во входящем voice-конвейере (`assessTranscriptConfidence` есть, но bridge берёт только текст) | `voice-intake.ts`, `index.ts` | исправлено (04) |
| D11 | Caption не хранится отдельно от OCR-текста | `chat-archive`, `ListenerMediaPipeline` | исправлено (04) |
| D12 | Custom-rules парсер — только regex; LLM structured flow с preview/подтверждением отсутствует | `chat-setup/RulePresets.ts` | исправлено (06) |

## Тест-harness

- `npm test` — `tsx --test "tests/**/*.test.ts"` (workspace-запуск `npx turbo run test`).
- `npm run typecheck` / `npx turbo run typecheck`.
- `npm run build` — `tsc -p tsconfig.json`.
- На момент аудита: 536 unit-тестов, 0 fail.
- Ограничения окружения: живого Telegram API нет — E2E строится на FakeBot
  (`TelegramBotLike`) и fault-injection поверх DI; реальный E2E описан в
  `docs/TELEGRAM-E2E-MATRIX.md`.
