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

Чистый класс с тремя зависимостями: `allowedUserIds`, `agent`, `sender`.

- `isAllowed(userId)`: **пустой `allowedUserIds` ⇒ `false` для всех** (это важно — пустой whitelist блокирует всех).
- `handleUpdate(update)`:
  1. нет сообщения/чата → `no-message`;
  2. нет `from.id` → `no-user`;
  3. не в whitelist → `not-allowed` (никакого ответа);
  4. `/start`, `/new`, `/status` → canned-ответы;
  5. `voice` → заглушка о транскрипции;
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
