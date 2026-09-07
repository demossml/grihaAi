# Архитектура grish-ai

Этот документ объясняет, **как всё устроено и почему**, чтобы новый агент (или человек) мог разобраться в проекте за один проход. Здесь — общая картина, платформа, поток сообщения, конфигурация, секреты, паттерны тестируемости и все важные «мелочи».

Оглавление:

1. [Что это за проект](#1-что-это-за-проект)
2. [Платформа pi.dev и модель расширений](#2-платформа-pidev-и-модель-расширений)
3. [Жизненный цикл расширения и события](#3-жизненный-цикл-расширения-и-события)
4. [Как сообщение проходит через агента](#4-как-сообщение-проходит-через-агента)
5. [Конфигурация и секреты](#5-конфигурация-и-секреты)
6. [Провайдеры, модели и bootstrap](#6-провайдеры-модели-и-bootstrap)
7. [Паттерны DI и тестируемости](#7-паттерны-di-и-тестируемости)
8. [Важные «мелочи» и подводные камни](#8-важные-мелочи-и-подводные-камни)

---

## 1. Что это за проект

`grish-ai` — TypeScript-переписывание ключевых возможностей агента **Nous Research Hermes** поверх платформы **pi.dev** (`@earendil-works/pi-coding-agent`). Имя агента — **Гриша**.

Финальная роль агента: **профессиональный ассистент менеджера / секретаря / бухгалтера** — расписания, документы, отчёты, переписка, исследования, заметки со встреч, лёгкая финансовая поддержка. Инструменты программирования — вторичны.

Проект развивается фазами. Полная история фаз — в [STATUS.md](../STATUS.md).

**Ключевой факт**: вся бизнес-логика — это **расширения (extensions)** для pi.dev, написанные на TypeScript. Сам «мозг» (LLM-цикл, стриминг, инструменты) предоставляет платформа; мы добавляем память, делегирование, cron, Telegram и т.д. через официальное Extension API.

---

## 2. Платформа pi.dev и модель расширений

pi.dev — рантайм для кодинг-агентов. Установлен как npm-пакет `@earendil-works/pi-coding-agent` (CLI `pi`, бинарь лежит в `node_modules/.bin/pi`).

Приложение запускается командой `npx pi` (или `pi`), которая:

1. Читает настройки из `.pi/settings.json`.
2. Загружает **расширения** из путей, перечисленных в `settings.json` (`extensions: [".pi/extensions/**/*.ts", ...]`).
3. Каждое расширение — это файл `index.ts` с `export default function (pi: ExtensionAPI) { ... }`.

Расширение получает объект `pi: ExtensionAPI` и:

- подписывается на события: `pi.on("session_start", handler)` и т.д.;
- регистрирует LLM-инструменты: `pi.registerTool({ name, label, description, parameters, execute })`;
- регистрирует slash-команды: `pi.registerCommand(name, { description, handler })`;
- шлёт сообщения в UI: `pi.sendMessage({ customType, content, display, details })`;
- шлёт сообщение агенту: `pi.sendUserMessage(content, { deliverAs })`;
- регистрирует/переопределяет провайдеров моделей: `pi.registerProvider(name, { apiKey, baseUrl, models })`;
- переключает модель: `pi.setModel(model)`.

Подробный справочник по каждому файлу и расширению — в [docs/EXTENSIONS.md](EXTENSIONS.md).

### Структура проекта (кратко)

```
grish-ai/
├── .pi/
│   ├── settings.json              # какие расширения и skills грузить
│   └── extensions/                # все расширения (это и есть «приложение»)
│       ├── core-agent/            # skills + политика делегирования в system-prompt
│       ├── first-run-setup/       # мастер первичной настройки (провайдер/модель/ключ)
│       ├── sqlite-rag-memory/     # гибридная память (SQLite + FTS5 + вектора)
│       ├── multi-agent/           # делегирование, боты, субагенты
│       ├── cron/                  # планировщик задач
│       ├── model-router/          # маршрутизация main/vision + analyze_image
│       ├── personal-learning/     # профиль пользователя + заметки + автодообучение
│       └── telegram-bot/          # Telegram-бот (long polling) + пул изолированных сессий
├── src/
│   ├── types/                     # общие TypeBox-схемы и TS-типы
│   └── utils/                     # чистые утилиты (конфиг, skills, embeddings, роутеры…)
├── skills/core/SKILL.md           # базовый skill (agentskills.io frontmatter)
├── tests/                         # node:test (unit), setup.ts
├── docs/                          # эта документация
└── README.md / STATUS.md
```

---

## 3. Жизненный цикл расширения и события

Порядок событий в типичной сессии pi.dev (важно для понимания расширений):

1. **`session_start`** — сессия создана/загружена/перезапущена. Расширения инициализируют своё состояние (открывают БД, запускают ticker, авто-старт Telegram).
2. **`before_agent_start`** — перед каждым ходом агента. Расширения могут **дополнить системный промпт** (`return { systemPrompt: event.systemPrompt + "..." }`). Так `core-agent` добавляет skills и политику делегирования, а `personal-learning` — профиль и заметки.
3. **Цикл агента**: LLM отвечает, при необходимости вызывает инструменты (`registerTool`), инструменты выполняются, результаты возвращаются в контекст.
4. **`agent_end`** — ход завершён (финальные `messages`).
5. **`agent_settled`** — после завершения и всех ретраев/компакций (используется `personal-learning` для авто-дообучения).
6. **`session_shutdown`** — сессия закрывается. Расширения закрывают БД, останавливают ticker/бот.

Плюс события уровня инструментов: `tool_call`, `tool_result`, `message_start/update/end`, `turn_start/turn_end` и т.д. Полный список — в типах `ExtensionAPI` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`).

**Контекст `ctx`** (второй аргумент обработчиков событий и команд):

- `ctx.ui.*` — диалоги (`select`, `confirm`, `input`, `notify`);
- `ctx.hasUI` — есть ли интерактивный UI (`true` только в режимах `tui` и `rpc`);
- `ctx.mode` — `"tui" | "rpc" | "json" | "print"`;
- `ctx.modelRegistry.find(provider, modelId)` — поиск модели;
- `ctx.sessionManager.getSessionId()` / `.getEntries()` — текущая сессия и её записи;
- `ctx.cwd`, `ctx.signal`, `ctx.abort()`, `ctx.waitForIdle()` и т.д.

**Мелочь**: в режиме `"json"` (без UI) `ctx.ui.*` — это no-op заглушки (ничего не падает), а `ctx.hasUI === false`. Это важно для Telegram-субсессий (см. [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md)).

---

## 4. Как сообщение проходит через агента

### Интерактивная сессия (CLI/TUI)

```
пользователь печатает в pi
        │
        ▼
pi вызывает before_agent_start всех расширений
        │   (core-agent: +skills/делегирование; personal-learning: +профиль)
        ▼
агентский цикл (LLM) — может вызывать инструменты:
        ├── memory_search / memory_add          (sqlite-rag-memory)
        ├── delegate_tasks / check_subagents    (multi-agent)
        ├── analyze_image                       (model-router)
        ├── cron_*                              (cron)
        └── get_user_profile / add_client_note  (personal-learning)
        │
        ▼
ответ ассистента рендерится в TUI
```

### Telegram-сообщение

```
Telegram update
        │
        ▼
TelegramBotController (grammy, long polling)
        │
        ▼
TelegramBridge (whitelist-проверка, команды, фото/документ/текст)
        │
        ▼
TelegramSessionPool.handleMessage(userId, text)
        │   └─ изолированный AgentSession на tg:<userId>
        ▼
agent_end → getLastAssistantText() → ответ в Telegram-чат
```

Полный разбор бота — в [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md).

---

## 5. Конфигурация и секреты

### Файл конфига

Конфиг хранится **вне репозитория**: `~/.grish-ai/config.json`.

- Базовая директория по умолчанию — `~/.grish-ai`.
- Переменная `GRISH_AI_HOME` переопределяет базу (используется в тестах).

Пути считаются в `src/utils/config.ts`:

- `getConfigDir()` — `GRISH_AI_HOME ?? HOME ?? cwd`, плюс `.grish-ai`;
- `getConfigPath()` — `.../config.json`;
- `loadConfig()` — читает и валидирует (минимально: `version === 1`, `provider`, `model`);
- `saveConfig()` — пишет с отступами.

### Схема `GrishAiConfig` (`src/types/config.ts`)

```ts
{
  version: 1,
  provider: GrishAiProvider,   // openai|anthropic|openrouter|google|xai|deepseek|custom
  model: string,
  apiKey?: string,             // можно не хранить, если ключ из env
  baseUrl?: string,            // обязательно для custom
  setupCompletedAt: string,    // ISO-дата
  telegram?: { botToken: string; allowedUserIds?: number[] },
  models?: { main?: ModelConfig; vision?: ModelConfig }   // Phase 10
}
```

### Секреты

- **API-ключ DeepSeek** и **Telegram-токен** лежат **только** в `~/.grish-ai/config.json` — вне репозитория.
- В репозитории **нет** `.env` и `.grish-ai/` (это в `.gitignore` вместе с `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `tests/.tmp-db/`).
- GitHub-репозиторий приватный; перед push обязательно убедиться, что секреты не попали (см. историю сессии).

---

## 6. Провайдеры, модели и bootstrap

Логика «включить модель и провайдера» вынесена в `src/utils/provider-bootstrap.ts` и переиспользуется двумя местами:

1. `first-run-setup` — для основной сессии;
2. `telegram-bot` — для изолированных субсессий.

Функция `applyConfig(pi, ctx, cfg)`:

1. Если провайдер `custom` — регистрирует кастомный endpoint (`api: "openai-completions"`, `baseUrl`, список из одной модели).
2. Иначе, если в конфиге есть `apiKey`, — `pi.registerProvider(cfg.provider, { apiKey })`.
3. Ищет модель через `ctx.modelRegistry.find(provider, modelId)`.
4. **Fallback для DeepSeek**: если модели нет во встроенном каталоге, регистрирует официальный endpoint `https://api.deepseek.com` с моделями `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` (vision).
5. `pi.setModel(model)` — активирует модель (возвращает `false`, если нет авторизации).

**Мелочь (критично)**: просто записать `process.env.DEEPSEEK_API_KEY = ...` **недостаточно** — pi перечитывает env только при старте. Поэтому ключ передаётся через `pi.registerProvider(name, { apiKey })`, что помечает провайдера как «авторизованного».

---

## 7. Паттерны DI и тестируемости

Проект намеренно построен вокруг **инъекции зависимостей**, чтобы логику можно было тестировать без реального LLM и сети:

| Компонент | Что инжектируется | Реальная реализация | Эмуляция/заглушка |
|---|---|---|---|
| Память | `EmbeddingService` | (пока нет) | `HashingEmbeddingService` (детерминированный) |
| Субагенты | `SubAgentRunner` | (пока нет) | `emulatedRunner` (возвращает шаблонный текст) |
| Cron | `CronRunner`, `CronChangeDetector` | (пока нет) | `emulatedRunner` |
| Vision | `VisionCaller` | (пока нет) | `emulatedVision` |
| Обучение | `LearningLlm` | (пока нет) | `emulatedLlm` (пустая выдача) |
| Telegram-бот | `TelegramBotFactory` (grammy `Bot`) | `new Bot(token)` | `FakeBot` в тестах |
| Telegram-сессии | `TelegramSessionFactory` | `createAgentSession` | `FakeAgentSession` в тестах |
| Роутер моделей | `ModelCaller` | (пока нет) | мок в тестах |

**Правило**: `src/utils/*` — чистые функции без побочных эффектов; `*.pi/extensions/*` — тонкие обёртки, которые связывают чистые утилиты с `pi`/`ctx`. Сервисы (`SqliteRagMemoryService`, `CronService`, `UserProfileService`, `ClientNotesService`) — классы с `init()`/`close()` и ленивой инициализацией.

Все «эмуляции» — это **осознанные заглушки** с комментарием «swap for a real … later». Они делают фазы рабочими end-to-end, пока не подключены реальные LLM-вызовы/нейронные эмбеддинги.

---

## 8. Важные «мелочи» и подводные камни

Это список нюансов, которые легко пропустить при чтении кода:

1. **Env-ключи не перечитываются после старта.** Ключ нужно регистрировать через `pi.registerProvider(name, { apiKey })`, а не присваивать `process.env` (см. §6).
2. **DeepSeek может отсутствовать во встроенном каталоге.** Поэтому `applyConfig` делает fallback-регистрацию официального endpoint. Список моделей сверен с `node_modules/@earendil-works/pi-ai/dist/providers/data/deepseek.json`.
3. **`ORIGINAL_ENV_KEYS`** в `first-run-setup` — снимок `Object.keys(process.env)` на момент загрузки расширения. Используется, чтобы отличать «ключ уже был в shell» от «ключа нет» в мастере (не предлагать ввод, если ключ уже есть).
4. **SQLite синхронный, обёрнут в async.** `better-sqlite3` синхронный; все методы сервисов объявлены `async` ради единообразного интерфейса, но внутри всё выполняется синхронно (кроме `await embeddingService.embed(...)`).
5. **FTS5 синхронизируется триггерами.** Для каждой таблицы (`facts`, `messages`, `insights`, `client_notes`) есть внешняя FTS5-таблица `*_fts` и триггеры `*_ai/_ad/_au`, которые держат индекс в актуальности. Удаление/обновление использует спец-запись `'delete'`.
6. **Поиск: FTS → LIKE fallback.** `buildFtsQuery` разбивает запрос на токены (`"токен"*` через `AND`). Если FTS ничего не нашёл (или запрос пустой/ошибочный) — fallback на `LIKE` с экранированием `%_\\`.
7. **Эмбеддинги — плейсхолдер.** `sqlite-ai`/`sqlite-rag` не опубликованы на npm (404 на 2026-09-07), поэтому написан `HashingEmbeddingService`: детерминированный «hashing trick» (FNV-1a → бакет → знак → L2-нормализация), dim=384. Это **не** нейронная модель — просто чтобы гибридный поиск работал end-to-end. Точка замены на реальную модель — интерфейс `EmbeddingService`.
8. **Гибридный поиск = RRF.** `reciprocalRankFusion` с `k=60` объединяет векторные и FTS-хиты; источник помечается `vector|fts|hybrid`.
9. **`adaptive-router.ts` пока нигде не подключён к расширениям.** `classifyComplexity`/`buildDelegationPlan` протестированы, но делегирование реально запускается, когда агент сам вызывает инструмент `delegate_tasks` (multi-agent). Роутер — готовый помощник на будущее.
10. **`tests/setup.ts` только создаёт папку, не удаляет.** Тесты идут параллельными процессами; общий `rm` гонялся и ломал чужие БД. Поэтому в `before()` только `mkdir`, а каждый тест использует уникальное имя БД (`getTestDbPath(name)`).
11. **Телеграм: `allowedUserIds: []` блокирует всех.** В `TelegramBridge.isAllowed` пустой список означает `false` для любого пользователя. При настройке обязательно добавить свой `user_id`.
12. **Телеграм `/new` не сбрасывает сессию.** Сейчас это canned-ответ «Новая сессия начата». Настоящий сброс изолированной сессии — дальнейшая работа.
13. **Команда `git`/публикация**: репозиторий приватный, коммит без секретов (см. `README` → «Конфигурация и секреты»). `gh` на машине не был авторизован на момент подготовки.

---

## Смежные документы

- [docs/EXTENSIONS.md](EXTENSIONS.md) — пофайловый справочник (типы, утилиты, каждое расширение, все инструменты и команды).
- [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md) — глубокий разбор Telegram-бота и пула изолированных сессий.
- [STATUS.md](../STATUS.md) — прогресс по фазам.
