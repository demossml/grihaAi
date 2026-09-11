# TELEGRAM_100_GAPS_REPORT

## Summary GREEN

Пакет «100% for Grisha» закрывает оставшиеся пробелы ежедневных офисных
сценариев Telegram-слоя. 649 unit-тестов зелёные, typecheck/build зелёные.

## Implemented gaps

| ID | Gap | Что сделано |
|---|---|---|
| G1 | Media groups (альбомы) | `media-group-buffer.ts` (MediaGroupBuffer, debounce 1000мс); bridge-опция `processMediaAlbum` — один batch, shared caption, максимум один ход агента; pipeline по каждому файлу |
| G2 | Outbound media | `TelegramBotLike.api.sendPhoto`; `send_file` получил `kind: photo\|document` и `storageKey` (файл из постоянного хранилища, только своего чата, ACL + validateSendFile) |
| G3 | OCR cost controls | `ocr-limiter.ts` (per-chat скользящее окно), гейты размера/подсказок; policy-ключи `ocr_max_per_hour`, `ocr_min_bytes`, `ocr_max_bytes`, `ocr_skip_no_hint`; pipeline `skipExtraction` — файл сохраняется без vision |
| G4 | Start payload | `/start setup_<chatId>` (в т.ч. `/start@Bot`) → меню настройки этой группы в DM; в группе — подсказка открыть DM |
| G5 | video/video_note/audio | normalizer kinds + file_id; pipeline: audio/video_note → STT+архив, video → storage+архив needsReview (покадровый OCR — future); MIME whitelist расширен |
| G6 | pinChatMessage | `/pin` (reply) → `pin-bridge` → `bot.api.pinChatMessage` (disable_notification); canManage обязателен; ошибка прав — честный текст |
| G7 | chat_join_request | handler в контроллере + `approveChatJoinRequest`/`declineChatJoinRequest`; **default — только уведомление владельцу в DM**; автоодобрение исключительно при явном правиле `join_auto_approve` и ACL-допуске |
| G8 | Reply context | `replyTo` в normalizer → блок `[REPLY_TO]` в промпте агента (текст и медиа) |
| G10 | Edited media reprocess | `updateArchiveMediaRevision` — правка медиа обновляет caption/raw и ревизию без дубликата |
| G11 | Metrics export | `/status` для canManage — счётчики `telegram_*` из `metrics.ts` |

## Deferred (честно)

- **G9 Webhook mode** — отложен: требует HTTP-инфраструктуру (setWebhook +
  endpoint + secret) и решает проблемы деплоя, не сценариев Гриши. Long polling
  с reconnect-loop покрывает текущие сценарии. Включить позже флагом
  `telegram.mode=webhook` (точка входа уже совместима: `TelegramBotController`
  принимает любые update через `handleTelegramUpdate`).
- **Покадровый OCR видео** — явный non-goal пакета (видео сохраняется и честно
  помечается needsReview).

## Files changed

- `telegram-bot/media-group-buffer.ts` (новый)
- `telegram-bot/ocr-limiter.ts` → `src/services/documents/ocr-limiter.ts` (новый)
- `telegram-bot/pin-bridge.ts` (новый)
- `telegram-bot/normalizer.ts` — media_group_id, replyTo, video/video_note/audio
- `telegram-bot/TelegramBridge.ts` — альбомы, reply context, /start payload,
  /pin, /status, video/audio ветки
- `telegram-bot/TelegramBotController.ts` — join request, pin, sendPhoto,
  metrics; FakeBot-фильтры в тестах
- `telegram-bot/index.ts` — processMediaAlbum, pinHandler, statusHandler,
  joinRequestHandler, rate limit, G5 kinds
- `telegram-file-send/index.ts` — kind + storageKey
- `documents/ListenerMediaPipeline.ts` — video/audio, skipExtraction, gates,
  isEdited-ревизии
- `documents/media-storage.ts` — video/audio MIME
- `documents/media-retry.ts` — MediaRetryKind расширен
- `user-rules/chat-policy.ts` — policy-ключи G3

## Tests added

`tests/unit/gaps-g1-g11.test.ts` — 16 сценариев (все PASS): buffer, bridge-альбом,
лимиты, payload, pin, reply context, normalizer video/audio, pipeline audio/video,
join request, outbound photo, edited media, helpers.
Плюс обновлены FakeBot'ы (`telegram.test.ts`, `telegram-reconnect.test.ts`) и
`chat-policy.test.ts` (новые поля processing).

## Manual E2E checklist

1. Альбом из 3 фото чеков в группе → один ответ агента с OCR всех трёх.
2. Прислать фото без caption при `ocr_skip_no_hint` → сохранено без OCR.
3. `/start setup_-100123` в DM → меню настройки -100123.
4. Агент: `send_file` с `storageKey` сохранённого чека и `kind: photo`.
5. «что в том чеке?» как reply → агент видит [REPLY_TO].
6. `/pin` ответом на сообщение от владельца → закреплено.
7. Заявка на вступление → владельцу приходит уведомление.

## Residual risks

- **Cost**: альбомы умножают OCR-вызовы — G3-лимит ограничивает сверху;
  `archive_ocr_ingest` остаётся выключателем.
- **Webhook ops** (G9): требует публичный URL/TLS/секрет — отдельная работа по
  деплою.
- **Video OCR**: не выполняется; видео архивируются с needsReview.
- **Join auto-approve**: включать только осознанно (`join_auto_approve` +
  ACL-допуск) — по умолчанию выключено.
