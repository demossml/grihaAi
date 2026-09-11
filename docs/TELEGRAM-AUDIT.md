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
| D1 | `channel_post`, `edited_message`, `edited_channel_post` не маршрутизируются | `TelegramBotController.pollLoop`, `toTgUpdate` | **исправлено** (02): `normalizer.ts` + 4 update-фильтра |
| D2 | Early ACL блокирует listener-архив | `TelegramBridge.handleUpdate` | **исправлено** (03): ACL после archive-решения (`checkAgentAcl`) |
| D3 | Voice не архивируется в listener | bridge/`processMedia` | **исправлено** (04): voice → STT+архив в едином конвейере |
| D4 | Медиа-файлы удаляются после обработки | `ListenerMediaPipeline` | **исправлено** (05): `MediaStorage` + `telegram_media` |
| D5 | Retry-джобы застревают в `processing` | `media-retry.ts` | **исправлено** (07): `requeueStaleProcessing` |
| D6 | `/rules` без admin-проверки | `user-rules/commands.ts` | **исправлено** (08): `rules-auth.ts`, server-side getChatMember |
| D7 | Sender channel post не моделируется | `toTgUpdate`, bridge | **исправлено** (02): `sender_chat` отдельно от `from` |
| D8 | Edited-сообщения теряются | controller/bridge | **исправлено** (02): ревизии `is_edited`/`revision` |
| D9 | Дедуп не атомарен | `DocumentsRepository.insert` | **исправлено** (07): транзакция + повторная проверка |
| D10 | STT-confidence не используется в voice-конвейере | `voice-intake.ts` | **исправлено** (04): `assessTranscriptConfidence` в pipeline |
| D11 | Caption не отделён от OCR-текста | archive/pipeline | **исправлено** (04): колонка `caption` |
| D12 | Custom-rules — только regex | `RulePresets.ts` | **исправлено** (06): LLM structured extraction + validation + preview |

## Тест-harness

- `npm test` — `tsx --test "tests/**/*.test.ts"` (workspace-запуск `npx turbo run test`).
- `npm run typecheck` / `npx turbo run typecheck`.
- `npm run build` — `tsc -p tsconfig.json`.
- `npm run lint` — **не сконфигурирован** в проекте (нет lint-скриптов; строгость
  обеспечивается `strict` TypeScript и отсутствием `any`/необоснованных `!`).
- На момент финала: **633 unit-теста, 0 fail**; typecheck/build зелёные.
- Ограничения окружения: живого Telegram API нет — E2E строится на FakeBot
  (`TelegramBotLike`) и fault-injection поверх DI; реальный E2E описан в
  `docs/TELEGRAM-E2E-MATRIX.md`.
