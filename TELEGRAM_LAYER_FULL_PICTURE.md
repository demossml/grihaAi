# Telegram layer — full picture

Дата: 2026-09-13. Источник правды: runtime-код + тесты. Синтез аудитов
(TELEGRAM_LAYER_FINDINGS.md, audit follow-up) + серии Surgical Hardening
(P01–P09, коммиты de65a67…efbd347).

## A. Executive summary

1. **Ключевое требование работает**: любой участник group/supergroup общается с
   ботом «в рамках своей группы» — membership ACL по живому `getChatMember`
   (creator/administrator/member/restricted), fail closed. Подтверждено цепочкой
   `index.ts → TelegramBotController → TelegramBridge.checkAgentAcl →
   telegram-acl.ts` и тестами.
2. **Причина «тихой группы» владельца** — не баг ACL, а связка
   `owner не сконфигурирован` + `/setup` требовал глобальный canManage +
   `pending → silent by design`. Исправлено: recovery для Telegram-admin своей
   группы (P01), диагностика owner (P06), `/setup status` (P07).
3. **Главный product gap закрыт**: cron → Telegram-доставка (`chatId/threadId`,
   retry, авторизация) — P02.
4. **Идентичность анонимных админов** разделена: групповая сессия `tg:anon:`,
   архив без фейкового fromUserId (P03; live-payload — UNVERIFIED).
5. **Альбомы больше не теряются молча** при shutdown/reconnect (P05).
6. **getChatMember кэшируется** (90s, fail closed) — P04.
7. Регрессия: **850/850 unit-тестов зелёные**, `turbo typecheck build` 12/12.
   Integration-тесты: **NOT RUN** (директория пуста; live-проверки — в разделе I).

## B. What works (do not break)

- Membership ACL групп и строгий private ACL (`telegram-acl.ts`, `users.json`).
- Pending → agent silent (prefilter R-GR-1); onboarding DM-first, кнопки только в DM.
- Archive независим от agent ACL (listener/archivist; `assertCanReadChat`,
  `sourceChatId`-ветка для member своей группы).
- Медиа-конвейер: photo/document/voice/video/video_note/audio, альбомы, OCR/vision,
  expense-инжест, media-retry (SQLite), edited media, outbound media.
- Топики: `tg:{user}:{chat}:t:{thread}`, `message_thread_id` в исходящих.
- Reliability: per-chat `ChatSendQueue`, `sendWithRetry` (429/5xx), HTML→plain,
  typing heartbeat, agent turn timeout (90s/180s), reconnect.
- Owner: `config.ownerUserId` / `GRISHA_OWNER_ID`, bootstrap `ensureOwner`,
  system_update owner-only.
- Пресеты (R1): safe_default/team/secretary/listener/shop/only_me с
  archive-ключами у secretary/team/listener (+OCR у shop).

## C. Root cause: customer silent group (owner/setup/pending)

Цепочка, подтверждённая кодом (до серии):

```
ownerUserId пуст/неверный → ensureOwner молчит (return)
  → canManage=false для всех
  → /setup в DM: «Недостаточно прав» (глобальный gate до разбора аргумента)
  → Telegram-admin группы не мог восстановить setup
  → группа остаётся pending
  → prepareGroupTurn: groupConfigured=false → process=false
  → агент молчит даже на @bot (by design, не баг ACL)
```

Фиксы серии: P01 (recovery для admin группы), P06 (warn + лог resolved owner),
P07 (`/setup status`). Pending-silent сохранён как контракт.

## D. Code defects (table)

| ID | Дефект | Sev | Файл | Статус |
|---|---|---|---|---|
| D1 | `/setup <chatId>` требовал глобальный canManage (асимметрия с callback) | P0 | `chat-setup/handlers.ts` | **FIXED** P01 |
| D2 | `ensureOwner()` молчит при пустом owner | P1 | `src/services/UsersService.ts` | **FIXED** P06 |
| D3 | Анонимные админы делят fake id (слияние сессий/архива) | P1 | `TelegramBridge.ts` | **FIXED** P03 (guard; live UNVERIFIED) |
| D4 | `getChatMember` без кэша на каждый ход | P1 | `TelegramBotController.ts` | **FIXED** P04 |
| D5 | Альбомы: dispose() молча выбрасывал pending | P1 | `media-group-buffer.ts` | **FIXED** P05 (Phase A) |
| D6 | Канал: onboarding обещал диалог в канале | P2 | `chat-setup/handlers.ts` | **FIXED** P08 (copy) |
| D7 | Доки пресетов отстали от R1 (secretary/team/shop) | P2 | `docs/TELEGRAM-PRESET-MATRIX.md` | **FIXED** P08 |

## E. Missing product features

| Фича | Статус |
|---|---|
| Напоминания/секретарь → доставка в Telegram по расписанию | **ADDED** P02 (`telegramTarget`, delivery через существующий outbound/retry) |
| Durable inbox входящих альбомов (переживает краш в окне ~1s) | **DEFERRED** (Phase A достаточен для graceful shutdown; см. раздел I) |
| Авто-подмешивание последних N сообщений группы в промпт | **DEFERRED** (product-решение; сейчас — через `group_history` по запросу) |

## F. Ops checklist

- **Owner**: `config.ownerUserId` или `GRISHA_OWNER_ID`. При старте лог
  `[telegram-bot] owner resolved: <id>`; при отсутствии — WARN (P06). `/update`
  «не owner» при корректном id → проверить роль в `~/.grish-ai/users.json`
  (`role: owner`; bootstrap `ensureOwner` чинит при рестарте), сравнить
  `resolveOwnerId` chain (config → env).
- **BotFather**: выключить privacy mode для групп, где бот должен видеть все
  сообщения (иначе `listen_only`/`archive` не видят текст; `@mention` работает
  и в privacy mode). Обычным пресетам (require_mention) privacy mode не мешает.
- **Каналы**: бот архивирует посты, диалога в канале нет — добавить в группу
  обсуждений и настроить её отдельно (P08-текст при add).
- **Git update**: `system_update` (owner-only, git pull --ff-only + build +
  restart). Если origin ушёл — fetch+rebase (pushing через ssh 443).
- **Диагностика**: `/setup status` (DM, canManage) — pending-группы и кто может
  настроить; `[cron] telegram delivery ...` — статус доставки; `[media-group]
  dispose ...` — флаш альбомов при shutdown.

## G. Prioritized backlog

| ID | Title | Sev | Type | Depends | Fix size | Status |
|---|---|---|---|---|---|---|
| B1 | /setup recovery для Telegram-admin группы | P0 | code | — | S | DONE P01 |
| B2 | Cron → Telegram | P1 | product | — | M | DONE P02 |
| B3 | Anonymous admin identity | P1 | code | live verify | S | DONE P03 |
| B4 | getChatMember TTL cache | P1 | code | — | S | DONE P04 |
| B5 | Album graceful dispose (Phase A) | P1 | code | — | S | DONE P05 |
| B6 | Owner diagnostics + /setup status | P1/P2 | ops/code | — | S | DONE P06/P07 |
| B7 | Preset docs sync + channel copy | P2 | docs/copy | — | S | DONE P08 |
| B8 | Durable album ingress (media_retry + albumGroupId) | P2 | code | B5 обкатка | M | DEFERRED |
| B9 | Групповой контекст в промпт (последние N сообщений) | P2 | product | — | M | DEFERRED |

## H. Recommended fix order (phases)

1. P01 setup recovery → 2. P02 cron bridge → 3. P03 anonymous → 4. P04 cache →
5. P05 albums → 6. P06 diagnostics → 7. P08 docs/copy → 8. P09 regression.
Все фазы выполнены; см. TELEGRAM_SURGICAL_HARDENING_REPORT.md.

## I. Open questions / needs live verify

1. **Anonymous admin payload** (P03): какой именно `from`/`sender_chat` шлёт
   Telegram в группах с анонимностью и что вернёт `getChatMember(chatId,
   1087968824)`. Guard не зависит от этого, но метрики/логи стоит сверить на проде.
2. **Kick latency** (P04): после кика участника доступ может жить до 90s
   (TTL; ошибки API не кэшируются — fail closed сохранён).
3. **Cron delivery при рестарте** (P02): если бот был выключен в момент
   срабатывания — deliveryStatus="failed" в run-record (диагностируемо),
   повторной доставки нет (осознанное ограничение).
4. **Integration-тесты**: NOT RUN — live-сценарии требуют реального бота/группы.

## J. Appendix: file:line index

- `telegram-bot/telegram-acl.ts:32` — membership ACL (IN_GROUP_STATUSES, fail closed).
- `telegram-bot/TelegramBridge.ts:642` — identity/anon guard (P03).
- `telegram-bot/chat-auth.ts:35` — assertCanConfigureGroup (P01 reuse).
- `chat-setup/handlers.ts:262` — runSetupCommand (P01/P07).
- `cron/CronService.ts:11` — schema/migrations/delivery (P02).
- `cron/cron-bridge.ts` — registry delivery/auth (P02).
- `cron/cron-auth.ts` — target authorization (P02).
- `telegram-bot/chat-member-cache.ts` — TTL cache (P04).
- `telegram-bot/media-group-buffer.ts:70` — dispose flush (P05).
- `telegram-bot/TelegramBotController.ts:341` — sendQueue; `:366` memberCache;
  `:640` stop() + bridge dispose (P05).
- `src/services/UsersService.ts:218` — ensureOwner warn (P06).
- `telegram-bot/TelegramSessionPool.ts:65` — SUB_SESSION_EXTENSIONS (+cron, P02).
