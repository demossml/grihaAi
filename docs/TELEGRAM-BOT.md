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
ответ → bot.api.sendMessage(chatId, text)
```

---

## 2. Файлы и зоны ответственности

| Файл | Роль |
|---|---|
| `index.ts` | Точка входа расширения. Создаёт пул, регистрирует команды, авто-старт/остановку. |
| `TelegramBotController.ts` | Жизненный цикл grammy `Bot`: `start`/`stop`, приём сообщений, `toTgUpdate`. |
| `TelegramBridge.ts` | Чистая, без grammy, логика маршрутизации/авторизации (тестируется юнитами). |
| `TelegramSessionPool.ts` | Изолированные `AgentSession` на пользователя. |

---

## 3. Long polling: контроллер и бридж

### `TelegramBotController`

- Создаётся с тремя зависимостями (DI для тестов):
  - `agent: GrishaAgent` — функция, отвечающая на сообщение;
  - `allowedUserIds: number[]` — whitelist;
  - `botFactory: TelegramBotFactory` — по токену возвращает grammy-подобный бот (`TelegramBotLike`).
- `start(token)`:
  - если уже `running` — ничего не делает (защита от повторного старта);
  - создаёт бота, строит `TelegramBridge` с sender'ом `(chatId, text) => bot.api.sendMessage(chatId, text)`;
  - `bot.on("message", ctx => bridge.handleUpdate(toTgUpdate(ctx)))` — обработка асинхронно, `void`, чтобы не блокировать event loop;
  - `void bot.start().catch(...)` — в catch сбрасывает `running` и `bot`.
- `stop()` — `bot.stop()`, сброс состояния.
- `toTgUpdate(ctx)` — аккуратно достаёт поля из grammy-контекста в «нейтральный» `TgUpdate` (чтобы `TelegramBridge` не зависел от grammy).

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

Ответ агента — строка, отправляется через `sender`.

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
    extensionFactories: [coreAgent, multiAgent, modelRouter, providerBootstrap],
  }),
  sessionManager: SessionManager.create(cwd, sessionsDir), // файловая сессия на пользователя
  sessionStartEvent: { type: "session_start", reason: "startup" },
});
```

Затем:

```ts
await session.bindExtensions({ mode: "json" });
```

`bindExtensions` «привязывает» расширения к сессии и эмитит `session_start`, из-за чего inline-расширение `providerBootstrap` регистрирует провайдера + модель (вызывает общий `applyConfig` из `src/utils/provider-bootstrap.ts`).

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
   - по `agent_end` берёт ответ через `session.getLastAssistantText()`;
   - при ошибке/пустом ответе — фолбэк «Не удалось получить ответ от Гриши» / «Гриша не ответил».
4. Возвращает строку ответа (её бридж отправляет в чат).

`disposeAll()` — закрывает все субсессии (на `session_shutdown`).

---

## 6. Почему в субсессиях не все расширения

В субсессии намеренно включены только:

- `core-agent` (skills + политика делегирования);
- `multi-agent` (делегирование);
- `model-router` (`analyze_image`);
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

- Голос — заглушка (транскрипция не реализована).
- Фото/документ передаются агенту как `file_id` + подпись, но реальный vision-вызов в Telegram пока эмулирован (см. `model-router` `emulatedVision`).
- Память в субсессиях не изолирована по пользователям (расширения памяти намеренно исключены).
- Бот не логирует ошибки `bot.start()` (в catch сбрасывает состояние без вывода) — стоит добавить лог при диагностике.
