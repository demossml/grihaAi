# GROUP_RUNTIME_CONTRACT_REPORT

## 0. Meta
- Date (UTC): 2026-09-10
- Commit / branch: `c393504` on `main`
- Overall: **GREEN**

## 1. Executive summary
Реализован жёсткий runtime-контракт работы бота в Telegram-группах. Введён единый
конвейер `group-runtime.ts` (`prepareGroupTurn` + `processInboundMessage`): каждый
ход проходит ACL → configured-проверку → загрузку chat-scoped правил → hard-prefilter
в коде → STT/медиа → агент с `[GROUP_RULES]`-контекстом на каждый ход. Онбординг
возвращён к DM-only (R-GR-2 — пресет-кнопки из группы убраны, fallback в группу —
одна строка без кнопок). Добавлена очередь ретраев медиа (`media-retry.sqlite` +
воркер, R-GR-7) и policy-gated уведомление о плохом OCR (R-GR-8, default off).
Изоляция — sessionKey + chat-scoped rules/data; субагентов на группу нет. Все
нерегрессионные требования (R-GR-10) сохранены. Отложено: OCR video/audio, pin/media_group/poll.

## 2. Mapping to R-GR-* rules
| Rule ID | Implemented? | Evidence (file:function) | Notes |
|---|---|---|---|
| R-GR-1 | YES | group-runtime.ts:prepareGroupTurn (group-not-configured) + prefilter.ts:evaluatePreFilter (groupConfigured=false → BLOCKED) | 0 ответов, даже на @mention |
| R-GR-2 | YES | chat-setup/handlers.ts:onChatMemberAdded (DM-first, fallback одной строкой без кнопок), runSetupCommand (non-private → «только в DM») | Откат «онбординга в группе» Phase 27 — см. §13 |
| R-GR-3 | YES | group-runtime.ts:prepareGroupTurn (hard+soft до prefilter/агента); format-rules-context.ts; pool:TelegramSessionPool.runPrompt (per-turn префикс) | rulesContext — каждый ход |
| R-GR-4 | YES | evaluatePreFilter вызывается из prepareGroupTurn (код, не LLM) | |
| R-GR-5 | YES | изоляция = sessionKey; SUB_SESSION_EXTENSIONS не содержат per-group runtime | Нет SubAgentManager.spawnForGroup |
| R-GR-6 | YES | session-key.ts:buildTelegramSessionKey (tg:{uid}:{chat}[:t:{threadId}]) | тест session-key |
| R-GR-7 | YES | media-retry.ts:MediaRetryQueue/startMediaRetryWorker; хуки в index.ts (archiveHandler, documentIngest) | file_id не теряется |
| R-GR-8 | YES | group-runtime.ts:shouldNotifyPoorOcr + index.ts archiveHandler (notify только по флагу) | default off |
| R-GR-9 | YES | TelegramBridge.sendReply/makeSender (threadId во все ответы и документы) | |
| R-GR-10 | YES | без регрессий: caption_entities (mentions.ts), STT (voice-ветка), 429 (telegram-errors.ts), getChatMember (chat-auth.ts) — тесты зелёные | |
| R-GR-11 | YES | typecheck 0 ошибок, 499/499 unit | |
| R-GR-12 | YES | docs/TELEGRAM-BOT.md «Group Runtime Contract», STATUS.md Phase 30 | |

## 3. Pipeline
- Entry: `apps/agent/.pi/extensions/telegram-bot/group-runtime.ts` → `prepareGroupTurn` (синхронные шаги 2–4) и `processInboundMessage` (полный async).
- Порядок шагов: (1) ACL → (2) configured-проверка → (3) загрузка hard+soft → (4) hard-prefilter → (5) STT/медиа (инжест/архив + retry-очередь) → (6) агент с rulesContext → (7) ответ в тот же чат/тему.
- Bridge вызывает `prepareGroupTurn` из каждой ветки: text, photo, document, voice (дважды — до/после STT), contact, location — через `evaluateInput` (options.prepareTurn). Если `prepareTurn` не задан — legacy-fallback на `options.prefilter` (тесты).
- rulesService пуст: rulesContext всё равно содержит шапку `[GROUP_RULES]` (тест format-rules-context).

## 4. rulesContext
- Formatter: `apps/agent/.pi/extensions/user-rules/format-rules-context.ts` → `formatRulesContext(hard, soft)`.
- Пример вывода:
```
[GROUP_RULES]
Hard constraints are already enforced by the system prefilter.
- length=short
- hard:require_mention=true
[/GROUP_RULES]
```
- Инъекция: bridge → agent input `rulesContext` → grishaAgent → pool `handleMessage(meta.rulesContext)` → `runPrompt` префикс `${rulesContext}\n\n${message}` (каждый ход, не только первый).

## 5. Session isolation
- sessionKey: `tg:{userId}:{chatId}[:t:{threadId}]`.
- Два chatId расходятся: тест `telegram.test.ts` «D2: один user в двух чатах → две изолированные сессии» + `telegram-session-key.test.ts`.

## 6. Media retry queue
- DB: `~/.grish-ai/media-retry.sqlite` (`media-retry.ts`, таблица `media_retry_jobs`).
- enqueue call sites: `index.ts` — archiveHandler (catch download/OCR), documentIngest (catch download). Дедуп по chat+file_unique_id/file_id (pending/processing).
- Worker: `startMediaRetryWorker` (60с interval, claim 3), старт в `startBot`, стоп в `stopBot`; job → `getChatArchiveService().archiveMedia`.
- Backoff: `min(3600, 30·2^attempts)` сек; `attempts >= max_attempts(10)` → status `dead` (dead-letter, без бесконечного ретрая).

## 7. Poor OCR notify
- Ключи правил: `notify_poor_ocr` (bool, default false), `poor_ocr_confidence_below` (default 0.4).
- Код: `shouldNotifyPoorOcr` (group-runtime.ts) + archiveHandler в index.ts — notify только при флаге; в listen_only/mention-only по умолчанию тишина.

## 8. Explicit non-goals
- Нет per-group субагентов/процессов (только sessionKey-изоляция).
- pinChatMessage / sendMediaGroup / sendPoll не добавлялись.
- Webhook не добавлялся; ACL-модель не менялась.

## 9. Tests
- Команды: `npx tsc -p tsconfig.json --noEmit` (0 ошибок), `npx tsx --test "tests/unit/**/*.test.ts"`, `npx turbo run typecheck test build` (16/16).
- Итог: **499 passed / 0 failed / 0 skipped**.
- Новые файлы: `group-runtime.test.ts` (8), `format-rules-context.test.ts` (2), `media-retry-queue.test.ts` (4); обновлены `chat-setup-service.test.ts`, `telegram-setup-command.test.ts`, `telegram.test.ts` (R-GR-3 pool), `rule-presets.test.ts`, `group-configured-prefilter.test.ts`, `archivist-mode.test.ts`.
- Summary footer: `ℹ tests 499 / ℹ pass 499 / ℹ fail 0`.
- Flaky: нет.

## 10. Typecheck / build
- `npx tsc -p tsconfig.json --noEmit` → exit 0 (apps/agent + workspace).
- `npx turbo run typecheck test build` → 16/16 tasks успешны, exit 0.

## 11. Files changed
Runtime:
- `apps/agent/.pi/extensions/telegram-bot/group-runtime.ts` (новый)
- `apps/agent/.pi/extensions/user-rules/format-rules-context.ts` (новый)
- `apps/agent/src/services/documents/media-retry.ts` (новый)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts`
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts`
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts`
- `apps/agent/.pi/extensions/telegram-bot/index.ts`
- `apps/agent/.pi/extensions/chat-setup/handlers.ts` (R-GR-2)
- `apps/agent/src/services/documents/chat-archive.ts` (notify-флаги)
- `packages/skills/skills/core/SKILL.md`

Tests: `group-runtime.test.ts`, `format-rules-context.test.ts`, `media-retry-queue.test.ts` (новые); `chat-setup-service.test.ts`, `telegram-setup-command.test.ts`, `telegram.test.ts` (обновлены).

Docs: `docs/TELEGRAM-BOT.md`, `README.md`, `STATUS.md`, `GROUP_RUNTIME_CONTRACT_REPORT.md`.

## 12. Residual risks
- Воркер ретраев в проде запускается в том же процессе бота; при перезапуске pending-жобы остаются и будут дообработаны.
- OCR — StubExtractor (caption-парсинг): качество распознавания реальных фото зависит от будущего Vision-экстрактора; честный needsReview включён.
- Уведомление о плохом OCR требует ручного включения флага — по умолчанию тишина.
- R-GR-2 откатил «онбординг в группе» Phase 27 (см. §13): пользователи, привыкшие к кнопкам в группе, снова получают их в DM.
- Manual E2E checklist:
  1. Добавить бота в тестовую группу `-5239797479` → в группе тишина, в DM owner'а `5700958253` — кнопки пресетов.
  2. `/setup` в группе → «только в личных сообщениях»; в DM — клавиатуры.
  3. В pending-группе написать текст и @mention → ноль ответов.
  4. Применить пресет (listener) → сообщения без @mention тихо архивируются (`~/.grish-ai/documents.sqlite`, таблица `chat_archive`), @mention → ответ.
  5. Оборвать сеть при отправке фото → job в `media-retry.sqlite`, через 60с воркер дообрабатывает.
  6. Ответы в форумной теме — в ту же тему.

## 13. Deviations from this prompt
- **R-GR-2 vs Phase 27:** предыдущий патч (по согласованию заказчика) отправлял онбординг-кнопки в группу и разрешал `/setup` в группе. Данный документ объявлен единственным источником правды (R-GR-2: кнопки только в DM) — онбординг возвращён к DM-only. Откат задокументирован здесь и в STATUS.
- **prepareGroupTurn deps:** в спецификации `shouldProcess: typeof shouldProcessMessage` (boolean); реализовано `evaluate: typeof evaluatePreFilter`, т.к. boolean теряет `suppressReply/archive` режима архивариуса (R-GR-8/lisеn_only). Поведение строже/полнее.
- **Worker trigger:** выбран interval (60с), а не только opportunistic tick — проще и предсказуемее; spec разрешал оба.
- **Voice retry:** enqueue для voice не делается (spec — optional; STT-сбой уже сообщается пользователю и требует нового входа).

## 14. Reviewer notes
- Сверить R-GR-1/R-GR-2 руками (E2E п.1–3): это самое чувствительное изменение (откат Phase 27).
- Проверить таблицы: `chat_archive` и `media_retry_jobs` в `~/.grish-ai/`.
- Прогнать `npx turbo run typecheck test build` на чистой машине.
- Вопрос на будущее: Vision-экстрактор (OCR качество) и уведомления по `notify_poor_ocr` для пресета shop.
