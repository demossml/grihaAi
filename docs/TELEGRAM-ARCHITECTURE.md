# TELEGRAM-ARCHITECTURE — актуальная архитектура Telegram layer

После промптов 01–10 (2026-09-11). Источник истины — код
`apps/agent/.pi/extensions/telegram-bot` и `apps/agent/src/services/documents`.

## Схема потока update

```text
Telegram update (message | channel_post | edited_message | edited_channel_post)
   │
   ▼
TelegramBotController.handleTelegramUpdate
   │  normalizer.ts → NormalizedTelegramUpdate
   │  (sender: from/user ИЛИ sender_chat; topics — единая логика)
   ▼
TelegramBridge.handleUpdate
   │  evaluateInput → prepareGroupTurn:
   │    configured (R-GR-1) → правила SQLite → policy (ChatPolicy) → TurnDecision
   ▼
   ├── archive/text      → ChatArchiveService (по policy.archive.*, БЕЗ agent ACL)
   ├── media (photo/document/voice) → processMedia →
   │      ListenerMediaPipeline: MediaStorage (persistent) → OCR/STT →
   │      chat_archive (caption отдельно) → expense_documents при policy
   └── agent path        → checkAgentAcl (только реальные user'ы, после archive)
          → TelegramSessionPool → agent (rulesContext каждый ход)
```

## Ключевые решения

| Тема | Решение |
|---|---|
| Update routing | 4 вида update через единый `normalizeTelegramUpdate`; сервисные сообщения отсекаются в контроллере |
| Sender | `from` (user) и `sender_chat` (канал/группа) разведены; `sender_chat.id` не является user-авторизацией |
| Listener vs agent | Archive/Media разрешены chat policy; agent — только ACL после archive-решения (без ACL-bypass) |
| Policy | Версионированная `ChatPolicy` (SQLite `chat_policy` + `chat_policy_history`); deterministic `evaluateChatPolicy`; LLM — только при создании custom-правил (structured JSON + validation + preview + confirm) |
| Media | Единый pipeline photo/document/voice: persistent storage → extraction → archive → ingest; voice → STT (`assessTranscriptConfidence`); caption отдельно от raw_text |
| Storage | `~/.grish-ai/media/telegram/<chat>/<YYYY>/<MM>/<sha256>.<ext>`; metadata `telegram_media` (UNIQUE chat_id+message_id+file_unique_id, processing_status) |
| Reliability | media-retry с bounded backoff+jitter, stale-processing recovery, transient/permanent, dead-letter; атомарный дедуп |
| Security | fail-closed onboarding; мутации правил — только creator/administrator (server-side) или canManage; deny при API error |
| Topics | `tg:{userId}:{chatId}:t:{threadId}`; archive/expense хранят `thread_id` |
| Observability | structured logs (update_id/chat/thread/message/media/decision/status) + метрики `telegram_*` |

## Файлы

- `normalizer.ts` — нормализация update.
- `TelegramBotController.ts` — long polling + dispatch + toTgUpdate.
- `TelegramBridge.ts` — чистый routing/authorization (unit-testable).
- `group-runtime.ts` — prepareGroupTurn (configured → rules → policy).
- `rules-auth.ts` — admin-gate мутаций /rules.
- `metrics.ts` — счётчики telegram_*.
- `user-rules/chat-policy.ts` — ChatPolicy + store + evaluator.
- `chat-setup/policy-extraction.ts` — LLM structured extraction custom-правил.
- `documents/media-storage.ts` — MediaStorage (LocalMediaStorage).
- `documents/ListenerMediaPipeline.ts` — единый медиа-конвейер.
- `documents/media-retry.ts` — retry queue + worker (recovery).
- `DocumentsRepository.ts` — expenses + chat_archive (ревизии правок, caption) + telegram_media.

## Известные ограничения Telegram Bot API

- `channel_post`: нет `from`, только `sender_chat` → agent-путь для каналов отключён.
- Mentions в каналах невозможны → `require_mention` не применяется к каналам.
- `file_unique_id` может отсутствовать в старых клиентах → fallback на `file_id`.
- Нет server-side уверенности в `file_size` до скачивания → лимит проверяется в storage.
