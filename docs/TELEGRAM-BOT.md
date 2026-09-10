# Telegram-бот: глубокий разбор

Здесь — всё, что касается встроенного Telegram-бота: как он устроен, почему работал как «EchoBot», и как устроена изоляция сессий на пользователя.

Оглавление:

1. [Общая схема](#1-общая-схема)
2. [Файлы и зоны ответственности](#2-файлы-и-зоны-ответственности)
3. [Long polling: контроллер и бридж](#3-long-polling-контроллер-и-бридж)
4. [История бага «EchoBot»](#4-история-бага-echobot)
5. [Изоляция сессий (TelegramSessionPool)](#5-изоляция-сессий-telegramsessionpool)
6. [Почему в субсессиях не все расширения](#6-почему-в-субсессиях-не-все-расширения)
7. [Команды и настройка](#7-команды-и-настройка)
8. [Известные ограничения](#8-известные-ограничения)

---

## 1. Общая схема

Бот работает в режиме **long polling** (никаких webhook). Один Гриша = один Telegram-бот.

```
Telegram API
     │ update (сообщение)
     ▼
grammy Bot.start()  — long polling
     │
     ▼
TelegramBotController  — владеет ботом, переводит grammy ctx → TgUpdate
     │
     ▼
TelegramBridge  — whitelist, команды, разбор типа сообщения
     │
     ├─ /start, /status         → canned-ответы
     ├─ /new                    → resetHandler → TelegramSessionPool.reset(userId)
     ├─ voice                    → «голос получен (транскрипция пока нет)»
     ├─ photo / document         → текст-описание в агента (file_id)
     └─ text                     → в агента
     │
     ▼
TelegramSessionPool.handleMessage(userId, text)
     │   изолированный AgentSession на tg:<userId>
     ▼
ответ { text, filePath? }
     │
     ▼
bot.api.sendMessage(chatId, text)  +  filePath ? bot.api.sendDocument(chatId, filePath) : ничего
```

---

## 2. Файлы и зоны ответственности

| Файл | Роль |
|---|---|
| `index.ts` | Точка входа расширения. Создаёт пул, регистрирует команды, авто-старт/остановку. Адаптер реального `Bot`: `sendDocument` оборачивает путь в `new InputFile(path)` (иначе строка трактуется как remote file_id). |
| `TelegramBotController.ts` | Жизненный цикл grammy `Bot`: `start`/`stop`, приём сообщений, `toTgUpdate`. Sender: `sendMessage`, затем `sendDocument`, если ответ несёт файл. |
| `TelegramBridge.ts` | Чистая, без grammy, логика маршрутизации/авторизации (тестируется юнитами). Ответ агента — `{ text, filePath? }`. |
| `TelegramSessionPool.ts` | Изолированные `AgentSession` на пользователя. Возвращает `{ text, filePath? }`, забирая файл из `src/utils/telegram/session-files.ts`. |

---

## 3. Long polling: контроллер и бридж

### `TelegramBotController`

- Создаётся с тремя зависимостями (DI для тестов):
  - `agent: GrishaAgent` — функция, отвечающая на сообщение;
  - `allowedUserIds: number[]` — whitelist;
  - `botFactory: TelegramBotFactory` — по токену возвращает grammy-подобный бот (`TelegramBotLike`).
- `start(token)`:
  - если уже `running` — ничего не делает (защита от повторного старта);
  - создаёт бота, строит `TelegramBridge` с sender'ом `async (chatId, text, filePath) => { await sendMessage; if (filePath) await sendDocument; }`;
  - `bot.on("message", ctx => bridge.handleUpdate(toTgUpdate(ctx)))` — обработка асинхронно, `void`, чтобы не блокировать event loop;
  - `void bot.start().catch(...)` — в catch сбрасывает `running` и `bot`.
- `stop()` — `bot.stop()`, сброс состояния.
- `toTgUpdate(ctx)` — аккуратно достаёт поля из grammy-контекста в «нейтральный» `TgUpdate` (чтобы `TelegramBridge` не зависел от grammy).

**Доставка файла**: `TelegramBotLike.api.sendDocument(chatId, filePath)` в реальном адаптере (`index.ts`) делает `bot.api.sendDocument(chatId, new InputFile(filePath))` — grammy `InputFile` обязателен для локального пути (голая строка = remote `file_id`). В тестах `FakeBot` записывает переданный путь как есть — это граница, где grammy-специфика не нужна.

### `TelegramBridge`

Чистый класс с тремя зависимостями: `allowedUserIds`, `agent`, `sender` (+ опции).

- **Early ACL**: если контроллер передал `aclCheck` (UsersService), проверка идёт самой первой —
  ДО prefilter и агента. Deny в private → «Нет доступа.» (если не `ACL_DENY_REPLY=0`), в
  группах — молча. Без `aclCheck` — legacy-whitelist `allowedUserIds` (пустой ⇒ `false` для всех).
- `handleUpdate(update)`:
  1. нет сообщения/чата → `no-message`;
  2. нет `from.id` → `no-user`;
  3. не прошёл ACL → `acl-denied` (или legacy `not-allowed`, никакого ответа);
  4. `/start`, `/new`, `/status` → canned-ответы;
  5. `voice` → агенту шлётся `"Пользователь прислал голосовое сообщение.\nfile_id: ...\nПодпись: ..."`;
  6. `photo` → агенту шлётся `"Пользователь прислал изображение.\nfile_id: ...\nПодпись: ..."`;
  7. `document` → аналогично с `file_id`;
  8. иначе (текст) → `agent({ message: text, userId, platform: "telegram", sessionKey: "tg:<userId>" })`.

Ответ агента — `{ text, filePath? }`, отправляется через `sender(chatId, text, filePath?)`. Поле `filePath` заполнено только если ход агента сгенерировал файл (report-generator).

---

## 4. История бага «EchoBot»

Раньше бот был «EchoBot»: на любое сообщение отвечал `Гриша (эмуляция): <твой текст>`.

**Причина** — в `index.ts` была заглушка:

```ts
const emulatedAgent: GrishaAgent = async (input) => `Гриша (эмуляция): ${input.message}`;
```

Контроллер получал именно её, поэтому реальный агент нигде не вызывался. `TelegramBridge` и `TelegramBotController` были написаны правильно (через интерфейс `GrishaAgent`), но адаптер к реальному агенту не был написан.

**Решение**: `emulatedAgent` заменена на адаптер, который зовёт `TelegramSessionPool.handleMessage(userId, message)`, а пул запускает настоящий `AgentSession`.

---

## 5. Изоляция сессий (TelegramSessionPool)

Цель: **у каждого Telegram-пользователя своя сессия Гриши** (свой `sessionId`, своя история, никаких утечек между пользователями).

### Почему нельзя просто `pi.sendUserMessage`

`pi.sendUserMessage` шлёт только в **активную** сессию pi. Из Extension API нет способа смаршрутизировать сообщение в «чужую» сессию. А `ctx.newSession` доступен только в command-контексте и **переключает** активную сессию (это разрушило бы CLI-сессию владельца).

### Как сделано

Для каждого `userId` лениво создаётся **независимый `AgentSession`** через SDK `createAgentSession`:

```ts
createAgentSession({
  cwd,
  agentDir: getAgentDir(),
  resourceLoader: new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,                 // не грузить .pi/extensions автоматически (иначе рекурсия)
    extensionFactories: [coreAgent, multiAgent, modelRouter, userRules, gateway, reportGenerator, providerBootstrap],
  }),
  sessionManager: SessionManager.create(cwd, sessionsDir), // файловая сессия на пользователя
  sessionStartEvent: { type: "session_start", reason: "startup" },
});
```

Затем:

```ts
await session.bindExtensions({ mode: "json" });
```

`bindExtensions` «привязывает» расширения к сессии и эмитит `session_start`, из-за чего inline-расширение `providerBootstrap` регистрирует провайдера + модель (вызывает общий `applyConfig` из `src/utils/bootstrap/provider-bootstrap.ts`).

### Ключевые детали SDK

- `noExtensions: true` + `extensionFactories: [...]` — грузим **только** нужные расширения как inline-фабрики (иначе telegram-бот загрузился бы сам в себя — бесконечная рекурсия).
- `SessionManager.create(cwd, dir)` — новая файловая сессия в `~/.grish-ai/telegram/<userId>/sessions` (история переживает рестарт).
- `session.bindExtensions({ mode: "json" })` — `mode: "json"` даёт `ctx.hasUI === false` (UI-методы становятся no-op). Обязательный шаг: без него `session_start` не эмитится и модель/ключ не регистрируются.
- `resourceLoader.reload()` вызывается **до** `createAgentSession`, потому что SDK сам не перезагружает переданный loader (важная мелочь из исходников SDK).

### Обработка сообщения

`handleMessage(userId, message)`:

1. Достаёт/создаёт `SessionEntry` (внутри — `sessionPromise` и очередь `queue`).
2. Каждый вызов цепляется в **per-user очередь** (`entry.queue = entry.queue.then(run, run)`) — сообщения одного пользователя обрабатываются строго последовательно.
3. `runPrompt(session, message)`:
   - подписывается на событие `agent_end`;
   - `session.prompt(message, { source: "extension", streamingBehavior: "followUp" если занят })`;
   - по `agent_end` берёт ответ через `session.getLastAssistantText()` и файл через `takeSessionFile(sessionId)` (per-session registry, `src/utils/telegram/session-files.ts` — файл туда кладёт `generate_report`/`generate_presentation` через `setSessionFile`);
   - при ошибке/пустом ответе — фолбэк «Не удалось получить ответ от Гриши» / «Гриша не ответил».
4. Возвращает `{ text, filePath? }` (её бридж отправляет в чат: текст всегда, документ — при наличии файла).

`disposeAll()` — закрывает все субсессии (на `session_shutdown`).

---

## 6. Почему в субсессиях не все расширения

В субсессии намеренно включены только:

- `core-agent` (skills + политика делегирования);
- `multi-agent` (делегирование);
- `model-router` (`analyze_image`);
- `user-rules` (инъекция правил + Telegram-контекст в system-prompt);
- `gateway` (блокировка shell/мутаций для untrusted-веток внутри субсессии);
- `report-generator` (`generate_report`/`generate_presentation` — иначе Telegram-пользователь не смог бы генерировать отчёты);
- `providerBootstrap` (авторизация/модель).

**Исключены**:

- `first-run-setup` — мастер настройки не нужен (авторизацию делает `providerBootstrap`), а wizard может попытаться вывести интерактивные подсказки;
- `telegram-bot` — сам себя (рекурсия);
- `cron` — планировщик не нужен в чате;
- `sqlite-rag-memory` и `personal-learning` — у них **общие синглтоны и общая БД** (`~/.grish-ai/memory.sqlite`). Включение привело бы к двум проблемам:
  1. **утечка памяти между пользователями** (пользователь B увидел бы факты пользователя A через `memory_search`);
  2. **конфликт жизненного цикла** (`session_shutdown` одной сессии закрыл бы общую БД, которой ещё пользуются другие).

Изолированная «память на пользователя» — отдельная дальнейшая работа.

---

## 7. Команды и настройка

Настройка — в pi (CLI), а не в Telegram:

| Команда | Что делает |
|---|---|
| `/telegram-setup` | Интерактивно: токен + список разрешённых `user_id` через запятую; сохраняет и перезапускает бота. |
| `/telegram-status` | Токен set/missing, кол-во разрешённых, running?, **кол-во активных сессий**. |
| `/telegram-start` | Запустить long polling. |
| `/telegram-stop` | Остановить long polling. |

В самом Telegram пользователю доступны: `/start`, `/status`, `/new`.

`/new` — реальный сброс изолированной диалоговой сессии: `TelegramBridge` зовёт `resetHandler` → `TelegramSessionPool.reset(userId)`. Текущий `AgentSession` для `tg:<userId>` закрывается (`dispose()`), новый с чистым `sessionId` создаётся лениво на следующем сообщении.

**Что сбрасывается, а что нет:**

- **Сбрасывается** — только диалоговая сессия (история разговора/контекст этого `AgentSession`).
- **Не сбрасывается** — личная память (personal-learning: профиль, заметки), user rules, shared insights и любые durable-данные — они лежат вне пула и переживают `/new`.
- Файлы старой сессии на диске **не удаляются** (история остаётся доступной при необходимости).

Авто-старт: на `session_start` бот стартует сам, если в конфиге есть `telegram.botToken`; если токена нет — просто не запускается (без ошибок).

---

## 8. Известные ограничения

- Голос: файл голосового сообщения передаётся агенту как `file_id` (как фото/документ) —
  агент сам вызывает tool `transcribe_voice` (скачивание + STT через `@griha/stt`),
  включая переспрос при низкой confidence. Снаружи бот сам не транскрибирует.
- Фото/документ передаются агенту как `file_id` + подпись, но реальный vision-вызов в Telegram пока эмулирован (см. `model-router` `emulatedVision`).
- Память в субсессиях не изолирована по пользователям (расширения памяти намеренно исключены).

## 9. Запуск без TUI и устойчивость к сети

### Users ACL (runtime, без рестарта)

- **Store**: `~/.grish-ai/users.json` (JSON, атомарная запись tmp+rename). Источник правды —
  disk + in-memory cache; writes применяются к следующему входящему апдейту немедленно.
- **Роли**: `owner` (bootstrap из `config.ownerUserId`/`GRISHA_OWNER_ID`), `admin`, `user`,
  `blocked`. Owner через tools/команды НЕ назначается; нельзя удалить/демоутнуть
  единственного owner. Legacy `telegram.allowedUserIds` при пустом store мигрирует в
  users.json как `role="user"`.
- **Режим для неизвестных**: `config.aclMode` (или `ACL_MODE=open|closed`); по умолчанию
  `closed`, если задан owner/whitelist, иначе `open` (dev). Deny-ответ в private —
  «Нет доступа.», отключается `ACL_DENY_REPLY=0`; в группах всегда молча.
- **Управление**: slash-команда `/users [list | add <id> [role] | role <id> <role> | remove <id>]`
  (прямой handler без LLM) и tools `users_list`/`users_add`/`users_set_role`/`users_remove`
  (для натурального языка). Оба пути — только owner/admin (`canManage`).

### Chat onboarding + пресеты правил

- **Group setup contract (mandatory)**: пока группа pending — бот в ней **молчит по
  контенту** (R1/R-GR-1: prefilter → false, 0 токенов LLM, даже на @mention).
- **R-GR-2**: онбординг-UI (кнопки пресетов) — **только в DM** добавившему;
  если DM не доставлен в момент добавления — **один** короткий fallback в группу
  (текст без кнопок). `/setup` — только в DM (в группе — «только в личных сообщениях»).
- `safe_default` пишется при add (silent, R4), но status остаётся pending — настройка
  завершается только preset/skip (R5). Личные чаты не блокируются (R6). Callback
  пресетов — canManage/addedBy + групповой admin-статус или owner/admin бота (R7, FR-4).
  Никаких LLM-ответов «я пока не настроен» в pending-группе (R8).
- Повторный add не спамит онбордингом (FR-8); онбординг идемпотентен.
- Пресеты (`RulePresets.ts`): team / secretary / listener / shop / only_me + «Настроить самому»
  (детерминированный парсер + кнопки confirm/cancel) и «Оставить как есть».
  Callback-данные: `cs:{chatId}:{p:{preset}|custom|skip|confirm|cancel}` (≤64 байт).
- Состояние онбординга — `~/.grish-ai/chat-setup.json` (pending/completed/skipped,
  атомарная запись, `isConfiguredSync(chatId)`); правила пишутся в **тот же** User Rules store как structured
  key/value (scope=chat, source `preset:*`/`custom`) через `replaceChatManagedRules` —
  чужие custom-правила не трогаются. Повторный add не спамит онбордингом.
- Pre-filter читает structured-ключи в первую очередь (§9: listen_only, ignore_bots/service,
  only_my_messages[_user_id], require_mention/reply_to_bot, ignore_if_other_mention);
  soft-ключи (style/length/no_hallucinate_data/memory_write/language_mirror) подмешиваются
  в system prompt коротким блоком. `/setup` — список чатов в ожидании настройки.

### Group Runtime Contract

**Добавление в группу:** тишина в группе до настройки (completed|skipped); настройка — только в DM.

**Каждое сообщение (единый конвейер `group-runtime.ts`):**
1. ACL (`UsersService.isAllowed`);
2. configured-проверка (pending-группа → silent);
3. загрузка chat-scoped hard+soft правил;
4. hard-prefilter в коде (`evaluatePreFilter` — R-GR-4);
5. STT / медиа (инжест или архив с retry-очередью при сбое скачивания);
6. агент с `rulesContext` (`[GROUP_RULES]`-префикс — каждый ход, не только первый);
7. ответ в тот же чат и `message_thread_id` (R-GR-9).

**Изоляция (R-GR-5/6):** `sessionKey = tg:{userId}:{chatId}[:t:{threadId}]`; отдельного
OS-процесса/субагента на группу нет — изоляция через sessionKey + chat-scoped rules/data.

**Media reliability (R-GR-7):** сбой скачивания → job в `media_retry_jobs`
(`~/.grish-ai/media-retry.sqlite`), фоновый воркер (60с) с backoff
`min(3600, 30·2^attempts)` с; после max_attempts — dead-letter.

**Poor OCR notify (R-GR-8):** только при `notify_poor_ocr=true` в правилах чата
(default off; порог `poor_ocr_confidence_below`, default 0.4) — listen_only/mention-only не ломается.

### Документы / расходы (MVP)

- Фото/PDF чека или накладной (по policy `ingest_mode`: default `mention` — только при
  @mention/reply/ключевых словах в caption) скачивается во временный файл, извлекаются
  данные (StubExtractor: парсер caption, честный `needsReview`), запись сохраняется в
  `~/.grish-ai/documents.sqlite` (отдельная БД, scope=chat, дедуп по `file_unique_id`),
  temp удаляется. Короткий ack: «Сохранил: Ромашка — 15400 RUB (2026-09-01)».
- Tools `expenses_sum` / `expenses_list`: **default = вся история чата**; fromDate/toDate/
  period передаются ТОЛЬКО если пользователь явно сузил период (никаких дефолтных «14 дней»).
  Чужой chatId — только owner/admin. Пустой store → «Записей нет».
- Skill: `packages/skills/skills/expenses/SKILL.md` (цифры только из tool, не из памяти чата).

### Форумные темы (forum topics)

- `message_thread_id` извлекается из входящего сообщения (fallback — reply_to_message),
  идёт в контекст сессии и во **все** ответы бота (sendMessage `message_thread_id`) —
  ответ всегда в ту же тему. Обычные группы/DM — без изменений (threadId = undefined).
- Documents: ingest пишет `thread_id`; expenses_sum/list по умолчанию scope=**текущая тема**
  (полная история темы), `scope=chat` — только по явному «по всей группе». Даты — только
  по явной просьбе. Onboarding/ACL/rules остаются chat-level.

### Hardening P0+P1 (D1–D10)

Патч устойчивости/безопасности бота (см. `TELEGRAM_HARDENING_REPORT.md`). Не меняет
silent-until-configured (R1–R8) и forum-topic `message_thread_id`.

- **D1 Mentions**: `mentions.ts` — `collectMentionFlags(text, entities, self?)` учитывает
  и `entities` (текст), и `caption_entities` (подпись фото/документа); `mergeMentionFlags`
  — ИЛИ по обоим источникам. `botMentioned`/`startsWithOtherMention` идут в pre-filter.
  Без `username` обычный `@` не матчится (documented), `text_mention` по id — всегда.
- **D2 Session keys**: `session-key.ts` — `buildTelegramSessionKey({userId, chatId?, threadId?})`
  → `tg:{uid}:{chat}[:t:{threadId}]` (без chatId — `dm`). Ключ сквозной: bridge, pool,
  sessions-директория (`sanitizeDirSegment` против traversal), `/new` сбрасывает
  только один ключ.
- **D3 Voice/STT**: в DM голосовое → `transcribeVoice` (`@griha/stt`, temp-файл через
  telegram file API, удаляется в finally). Нет опции STT → «Голосовые пока недоступны.»
  (reason `stt-unavailable`); ошибка → «Не удалось распознать голос.» (`stt-failed`);
  пустой текст → переспрос (`stt-empty`). Агенту уходит только текст.
- **D4 Callback ACL**: `handleCallbackQuery` проверяет ACL через
  `options.aclCheck(userId, chatId)` (единый источник — UsersService) с fallback на
  legacy `allowedUserIds`; неавторизованный callback не исполняется.
- **D5 `/setup`**: `runSetupCommand` — в не-private «только в DM»; в DM `/setup <chatId>`
  → один inline-keyboard, без аргумента — до 5 keyboard'ов по pending-группам
  (D9-хинт «Есть группы без настройки: N»).
- **D6 getMe**: `pollLoop` вызывает `getMe` с try/catch-логом перед каждым bot instance.
- **D7 Plain fallback**: если HTML `sendMessage` не ушёл после ретраев, **один**
  plain-text фолбэк того же чанка (без parseMode, без ретраев) — пользователь не теряет
  ответ из-за невалидного HTML.
- **D8 Reload**: `ChatSetupService.loadSync(force)`/`reload()` — повторное чтение
  `chat-setup.json` без рестарта.
- **D9 `/start` hint**: в DM добавляет строку про pending-группы (`pendingGroupsHint`).
- **D10 Tests/docs**: 420 unit-тестов, обновлены `docs/TELEGRAM-BOT.md`, `STATUS.md`,
  `README.md`, `TELEGRAM_HARDENING_REPORT.md`.

### Send reliability (Пакет A)

- **429 с retry_after уважается**: `telegram-errors.ts` — `parseTelegramError`
  (классы: `retry_after`/`retryable`/`forbidden`/`bad_request`/`unauthorized`/`unknown`),
  `computeSendDelayMs` (retry_after → ровно N секунд, retryable → экспонента с jitter,
  прочее → 0), `shouldRetrySend`. Ретраятся только `retry_after`/`retryable`;
  403/401/400 и unknown — без повторов (кроме HTML→plain на верхнем уровне).
- `sendWithRetry` парсит ошибку перед каждой паузой и логирует `retry_after`
  явно. HTML-чанк при неудаче (в т.ч. 400 bad_request — сразу, без шторма) уходит
  plain-фолбэком через тот же `sendWithRetry`.
- **Per-chat send queue** (`send-queue.ts`): исходящие sendMessage/sendDocument
  сериализуются в рамках одного chat_id (меньше 429 в активных группах),
  разные чаты не блокируют друг друга.

### Group configuration authority (Пакет B)

- **Кто может настроить группу** (FR-4): creator/administrator этой группы
  (проверка через реальный `getChatMember` в момент действия) **или** пользователь
  с ролью owner/admin в ACL бота (`canManage`). Fail closed: 400/403 → «нет прав»,
  сетевой сбой → «не удалось проверить права». Проверка — на мутирующих
  callback-действиях (`cs:...:p|skip|custom|confirm|cancel`) и `/setup <chatId>` /
  `/setup` в группе.
- `toChatMemberEvent` читает событие через grammy-getter `ctx.myChatMember`
  (camelCase) или `ctx.update.my_chat_member` — плоское snake_case поле в
  контексте отсутствует (P0-фикс: раньше онбординг не запускался никогда).
- Сервисные сообщения (`new_chat_members`/`left_chat_member`, `new_chat_title`,
  `pinned_message` и т.п.) отсекаются в контроллере ДО агента (FR-6) с отдельным логом.
- Онбординг идемпотентен: повторный add при pending не дублирует онбординг-сообщение
  (FR-8); completed/skipped — no-op. Логи `my_chat_member` — событие/chat/actor/результат.

### Отправка файлов по запросу (`send_file`)

- Инструмент `send_file(filePath, caption?)` доступен агенту в Telegram-субсессиях
  (`telegram-file-send`). Целевой чат и тема берутся из контекста сессии
  (pool ставит `{chatId, userId, threadId}` перед каждым prompt) — файл уходит в тот
  же чат/тему, откуда пришёл запрос, через мост в контроллер: текущий bot instance,
  per-chat очередь, sendWithRetry (retry_after/429), grammy `InputFile`.
- Валидация: файл существует, обычный (не директория), ≤50 МБ, внутри разрешённых
  корней (tmp / cwd / `~/.grish-ai`); ACL — `UsersService.isAllowed` (как у входящих).
  Ошибки — понятным текстом, без падения бота. Лог: кто/что/куда + file_id/message_id.
- Не затрагивает доставку файлов report-generator (`session-files.ts`) — это отдельный путь.

### Typing indicator

Пока обрабатывается разрешённое сообщение (после prefilter: STT/OCR/LLM/tools), бот шлёт
`sendChatAction(typing)` каждые ~4с до отправки ответа (`typing-heartbeat.ts`, finally —
обязательная остановка). В pending-группе / ACL deny / prefilter block / silent-archive —
typing НЕ отправляется. Форум — тот же `message_thread_id`.

### Listener mode (listen_only)

- Не отвечает, пока нет `@mention` или reply на сообщение бота (после этого патча).
- Фото/документы автоматически скачиваются и проходят OCR/extract:
  - `chat_archive` — сырой архив (raw_text, confidence, needs_review, ocr_status);
  - `expense_documents` — при распознанных полях и policy `archive_ocr_ingest`
    (одно скачивание, дедуп по file_unique_id; `expense_id`-ссылка в архиве).
- OCR — **тот же vision-backend, что и `analyze_image` в личном чате**
  (`VisionExtractor` + `createHttpVisionCaller`; без `models.vision.apiKey` —
  честный StubExtractor). kind определяется по тексту (receipt/invoice/waybill),
  сумма/дата/поставщик — парсерами; без суммы — `needsReview`.
- Сбой сети → `media-retry` очередь → на ретрае ПОЛНЫЙ конвейер (OCR+ingest), не только архив.
- `notify_poor_ocr` (default off) — единственное уведомление о низком качестве распознавания.
- LLM на каждое фото в listen_only не включается; фоновая обработка не зависит от вызова агента.

### Слушатель-архивариус (`listen_only`)
- Пресет `listener` (и custom-правило `listen_only: true`) переведён в режим
  «обрабатывать, но не отвечать»: **все** сообщения группы (текст, фото, документы)
  доходят до обработки и архива, а текстовый ответ в чат подавляется без явного
  `@mention` (решение: reply на бота обращением НЕ считается).
- Pre-filter (`evaluatePreFilter`) возвращает `{process, suppressReply, archive}`;
  при `listen_only` игнор ботов/сервисных сохраняется, `require_mention` не блокирует
  обработку. Pending-группа по-прежнему молчит целиком (R1).
- Архив — таблица `chat_archive` в `~/.grish-ai/documents.sqlite` (`ChatArchiveService`):
  текст — дедуп по (chat_id, message_id); медиа — скачивание → extract (OCR/парсинг) →
  дедуп по (chat_id, file_unique_id), сырой OCR-текст + флаги (`needs_review`/`confidence`).
  Распознанные чеки/накладные дополнительно пишутся в `expense_documents` (одно
  скачивание, расходы продолжают работать). Ошибки архива не роняют обработку.
- Индикатор «печатает…» (`sendChatAction typing`) включается сразу после приёма
  сообщения — в т.ч. в тихих режимах, где ответа не будет вовсе.

- **Headless-запуск**: `node_modules/.bin/tsx src/bot.ts` (из `apps/agent`) — полный набор
  расширений через `DefaultResourceLoader`, `bindExtensions({ mode: "json" })`; long
  polling стартует на `session_start`. `script`/TUI не нужны; systemd-юнит:
  `deploy/griha-ai.service` (`Restart=on-failure`, процесс завершается с ненулевым кодом
  при ошибке старта, лог — в journal).
- **Модель**: `first-run-setup` (основная сессия) и `providerBootstrap` (субсессии)
  применяют `~/.grish-ai/config.json` через `applyConfig`; результат и причина неудачи
  логируются (`[provider-bootstrap] model activated: ...` / `setModel failed ...`).
- **Сеть (РКН)**: по умолчанию Telegram ходит **напрямую, без прокси**, через ОДИН
  общий `TelegramResilientFetcher` (`telegram-network.ts`, `sharedTelegramFetcher` —
  синглтон на процесс поверх `node:https`):
  - IP `api.telegram.org` переобнаруживаются каждые 10 минут (системный DNS + DoH Google +
    DoH Cloudflare, валидация/дедуп); seed-список (`149.154.167.220`, `149.154.166.110`)
    добавляется в конец **всегда** — страховка, если DoH/DNS вернули только
    заблокированные РКН адреса;
  - при установке соединения IP перебираются по порядку **sticky → системный DNS →
    остальные IP**; успешный IP запоминается (sticky), при connect-сбое sticky
    сбрасывается; ретраится **только connect-уровень** (ECONNREFUSED/ETIMEDOUT/…),
    HTTP 4xx/5xx IP не меняет;
  - TLS SNI и HTTP `Host` при подключении к IP остаются `api.telegram.org`;
  - keep-alive: живой сокет переиспользуется между запросами (в т.ч. соседними
    long polling), новые TCP-коннекты не создаются;
  - логи: обнаруженные IP, назначение/сброс sticky, IP и число попыток коннекта.
  - Через тот же синглтон идут **все** запросы к api.telegram.org: grammy Bot API
    (`client.fetch`) и скачивание файлов (`getFile` → `/file/...` → vision/STT,
    `telegram-files.ts`). Глобальный `fetch` к api.telegram.org не используется
    (он резолвит только заблокированный DNS-IP и падает с ETIMEDOUT).
  - Legacy-путь через `HTTPS_PROXY` (`proxy.ts`, `HttpsProxyAgent`) включается только
    при `TELEGRAM_USE_PROXY=1`.
  `pollLoop` пересоздаёт бота через 10с после сбоя long polling; отправка
  ретраится до 5 раз с паузой 3с×попытка (grammy не ретраит HTTP 502 от прокси).
- **Логируются**: входящее сообщение, результат отправки (успех/ошибка), ошибки
  `bot.start()`/`bot.stop()`.
