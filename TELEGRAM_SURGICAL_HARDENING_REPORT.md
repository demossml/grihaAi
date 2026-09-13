# TELEGRAM SURGICAL HARDENING REPORT

**Серия**: GRIHA AI — Telegram Layer, Surgical Production Hardening (P01–P09).
**Дата**: 2026-09-13. **Ветка**: main, коммиты `de65a67…efbd347`.

## Итоговая таблица

| Area | BeforeChange | Tests | Risk | Status |
|---|---|---|---|---|
| Setup recovery (`/setup <chatId>`) | глобальный canManage до разбора аргумента | 14 (+9 новых) | низкий | **FIXED** P01 |
| Owner diagnostics | `ensureOwner` молчал без owner | +2 (warn-once, no-mutation) | ~0 | **FIXED** P06 |
| Anonymous identity | fake id 1087968824 = слияние сессий/архива | +7 (guard, архив, топик, channel) | низкий; live UNVERIFIED | **FIXED** P03 |
| getChatMember cache | без кэша, каждый ход API | +6 (TTL, fail-closed, инвалидация) | низкий | **FIXED** P04 |
| Albums | dispose() = silent loss | +6 (flush, 2 альбома, failure, bridge) | низкий | **FIXED** P05 (Phase A) |
| Cron → Telegram | моста не было | +19 (delivery, retry, миграции, auth) | средний | **FIXED** P02 |
| Setup diagnostics | только /setup (keyboards) | +3 (`/setup status`) | ~0 | **FIXED** P07 |
| Docs/preset consistency | MATRIX отставал от R1 | — | 0 runtime | **FIXED** P08 (+channel copy) |
| Regression | — | 850/850 unit green | — | **PASS** P09 |

## FILES CHANGED

- `apps/agent/.pi/extensions/chat-setup/handlers.ts` (P01/P07/P08)
- `apps/agent/src/services/UsersService.ts` (P06)
- `apps/agent/src/types/index.ts` (P02)
- `apps/agent/.pi/extensions/cron/CronService.ts`, `cron/index.ts`,
  `cron/cron-bridge.ts` (новый), `cron/cron-auth.ts` (новый) (P02)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBridge.ts` (P03/P05)
- `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` (P02/P04/P05)
- `apps/agent/.pi/extensions/telegram-bot/index.ts` (P02/P06)
- `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` (P02)
- `apps/agent/.pi/extensions/telegram-bot/chat-member-cache.ts` (новый, P04)
- `apps/agent/.pi/extensions/telegram-bot/media-group-buffer.ts` (P05)
- Тесты: `telegram-setup-command`, `cron-telegram` (новый), `anonymous-admin`
  (новый), `chat-member-cache` (новый), `media-group-dispose` (новый),
  `users-service`, `chat-setup-service`
- Доки: `docs/TELEGRAM-PRESET-MATRIX.md`, `docs/TELEGRAM-BOT.md`,
  `TELEGRAM_LAYER_FULL_PICTURE.md` (новый), этот отчёт

## FILES NOT CHANGED

`telegram-acl.ts`, `rules-auth.ts`, `normalizer.ts`, `session-key.ts`,
`send-queue.ts`, `file-send*.ts`, `threads.ts`, `typing-heartbeat.ts`,
`telegram-errors.ts`, `telegram-network.ts`, `telegram-ips.ts`, `proxy.ts`,
`RulePresets.ts` (runtime), `ChatSetupService.ts`, `group-runtime.ts`,
`prefilter.ts`, `media-retry.ts`, OCR/vision/expenses-конвейер, `documents/`,
`group-memory/`, `system-update/`, `api/`, `packages/*` (кроме types агента).

## DATABASE MIGRATIONS

- `memory.sqlite` (cron): `cron_jobs` + `chat_id TEXT`, `thread_id TEXT`;
  `cron_runs` + `delivery_status TEXT`. Все nullable, идемпотентные
  (PRAGMA-check, паттерн `state_snapshot`), backward-compatible — старые jobs
  без target работают как прежде. Тест «старая БД → миграция» зелёный.
- Других миграций нет. DROP/DELETE данных не выполнялось.

## TESTS EXECUTED

- `npx tsx --test "tests/unit/**/*.test.ts"` → **850 pass / 0 fail**.
- Новые: P01-матрица 9, cron-telegram 19, anonymous-admin 7, chat-member-cache 6,
  media-group-dispose 6, owner-warn 2, setup-status 3, channel-copy 1.
- Integration: **NOT RUN** — директория `tests/integration` пуста; live-сценарии
  в разделе I FULL_PICTURE.

## TYPECHECK / BUILD

`npx turbo run typecheck build` → **12/12 successful** (после каждой фазы).

## KNOWN UNVERIFIED ITEMS

1. Anonymous-admin payload (реальный `from`/`sender_chat` и статус
   `getChatMember(1087968824)`) — LIVE-UNVERIFIED; guard от этого не зависит.
2. Kick-латентность ≤90s из-за TTL (ошибки не кэшируются — fail closed).
3. Cron delivery при выключенном боте в момент срабатывания —
   `delivery_status=failed` без повторной доставки (осознанно, диагностируемо).

## ROLLBACK PLAN

- Каждая фаза — отдельный коммит: `de65a67` (P01), `e611cca` (P02), `46244b7`
  (P03), `70b73e7` (P04), `271cc1c` (P05), `a9410a6` (P06+P07), `96a3fc4` (P08),
  `efbd347` (P09 docs), + отчёты. Откат фазы — `git revert <commit>`.
- Миграции nullable → откат кода не ломает БД; данных не удалялось.
- Контракты (membership ACL, pending-silent, archive≠agent ACL, медиа,
  топики, owner) не менялись — регрессия маловероятна и покрыта 850 тестами.
