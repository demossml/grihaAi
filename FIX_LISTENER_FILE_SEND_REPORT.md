# FIX: Listener @mention silence + reliable file send

Дата: 2026-07 (repo: grihaAi, ветка main)

## Проблемы

1. **Listener молчал даже на @mention.** В `prepareGroupTurn` (group-runtime.ts) при
   `process=false` из prefilter все флаги ответа обнулялись: `archive` и
   `suppressReply` всегда становились `false`, а причина — всегда "prefilter".
   Из-за этого:
   - текст в listener-чате без @mention не архивировался (ветка `gate.archive`
     в TelegramBridge никогда не срабатывала через prepareGroupTurn);
   - невозможно было отличить «тихо архивировать» от «жёсткий блок».
2. **getMe без ретраев.** `realBotFactory.start()` делал `getMe` ровно один раз;
   при нестабильной сети `botSelf` оставался `undefined` → mention-флаги не
   считались → бот молчал даже на корректный @mention.
3. **Mention-матч был хрупким:** сравнение `mentionText.toLowerCase() ===
   "@" + username.toLowerCase()` не нормализовывало ведущий `@` и не учитывало
   username с разным регистром из разных источников.
4. **Repair правил только для listener.** На старте правила переписывались лишь
   для пресета `listener` (и только с source "preset:listener"), остальные
   completed-пресеты не проверялись.
5. **`allowed_updates` не задавался** — бот тянул все типы update.
6. **send_file был ненадёжен:** `filePath` проверялся без единого resolver,
   `storageKey`-логика была продублирована в туле, allowed-roots были только
   `tmpdir + cwd` (нельзя было отправить файл из монорепо или медиа-стора по пути).

## Изменения

### A1 — prepareGroupTurn сохраняет флаги prefilter (group-runtime.ts)

```ts
if (!gate.process) {
  return blocked("prefilter", {
    archive: gate.archive === true,
    suppressReply: gate.suppressReply === true,
  });
}
```

`blocked()` теперь принимает опциональные флаги. `group-not-configured`
остаётся полностью блокирующим (archive/suppressReply = false).

### A2 — mention-нормализация + getMe с ретраями

- `mentions.ts`: `normUser(u) = u.replace(/^@/, "").toLowerCase()`; сравнение
  `normUser(mentionText) === normUser(self.username)`.
- `telegram-bot/index.ts`: `ensureBotSelf(api, maxAttempts=5)` — ретраи с
  backoff 1с·i, лог `[telegram-bot] getMe ok: id=... username=...`, fallback
  `TELEGRAM_BOT_USERNAME` env.

### A3 — универсальный repair правил на старте

Для каждого `status=completed` с `presetId` проверяется маркерное hard-правило
(`presetMarkerKey`): listener→`listen_only`, only_me→`only_my_messages`,
остальные→`require_mention`. Если маркера нет — `replaceChatManagedRules`
полным пресетом с source `repair:<preset>` **без сброса статуса**, лог
`[chat-setup] repaired preset rules for chatId=... preset=...`.

### A4 — явный allowed_updates

`bot.start({ allowed_updates: ["message","edited_message","channel_post",
"edited_channel_post","callback_query","my_chat_member","chat_join_request"] })`.

### A5 — архив при blocked-по-policy (TelegramBridge)

Уже было корректно (подтверждено тестами `listener-acl-separation.test.ts`):
`gate.archive → archiveQuietly → process:false ⇒ archived-silent`. Изменений нет.

### B1/B2 — единый resolver файлов (file-send.ts)

- `resolveOutboundFile(input, deps)` — `storageKey` (через `resolveStorageKey`)
  ИЛИ `filePath` (с проверкой корней и существования); `storageKey` не является
  путём.
- `assertAllowedPath` — realpath-нормализация с fallback на ближайший
  существующий родитель (macOS `/var` → `/private/var` симлинки).
- `defaultFileRoots()`: cwd, корень монорепо (`../..`), `os.tmpdir()`,
  `~/.grish-ai`, `~/.grish-ai/media`. `/` и `/home` целиком НЕ разрешены.

### B3/B4 — инструмент send_file (telegram-file-send/index.ts)

- Единый resolver + `validateSendFile`; описание тула предупреждает:
  «Never pass storageKey value in filePath».
- Короткие ошибки: «Файл в архиве не найден (storageKey).», «Путь вне
  разрешённых каталогов.», «Файл не найден на диске.».
- Опциональный `chatId` (кросс-чат) — только при `users.canManage(userId)`.

## Тесты

Новый файл `apps/agent/tests/unit/fix-listener-file-send.test.ts` (15 тестов):

- A1: prefilter-false сохраняет archive/suppressReply; mention разблокирует;
  pending остаётся полностью заблокированным.
- A2: `normUser` (case + ведущий @), mention в другом регистре, чужая mention,
  self без username.
- B1: storageKey → storage; storageKey не найден; filePath внутри корня; вне
  корней (`/etc/passwd`); файла нет; без обоих параметров.
- B2: defaultFileRoots содержит repo root, tmp, config dir; не содержит `/` и
  `/home`.

**Результат:** 664 unit-теста зелёные (было 649), `turbo typecheck` 10/10,
`turbo build` 6/6.

## Acceptance

- ✅ @bot в listener-группе → ответ после repair правил + getMe с ретраями.
- ✅ Обычный текст в listener → архив без ответа (archive переживает prefilter-block).
- ✅ Отправка по storageKey (архив) и по пути внутри разрешённых каталогов.
- ✅ Выход за пределы корней (/etc/passwd) отклоняется.
