# Архитектура grish-ai

> **Это единственный живой источник правды по архитектуре; `docs/archive/` содержит только историю, не актуальное состояние.**

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
9. [Генерация документов (report-generator)](#9-генерация-документов-report-generator)
10. [Фактическая карта компонентов](#10-фактическая-карта-компонентов)
11. [Слоистая модель и domain contracts](#11-слоистая-модель-и-domain-contracts)

---

## 1. Что это за проект

`griha-ai` — самостоятельный TypeScript-агент на платформе **pi.dev** (`@earendil-works/pi-coding-agent`). Имя агента — **Гриша**.

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

### Структура монорепы (кратко)

Репо — **Turborepo-монорепа** (npm workspaces): приложение и библиотеки разнесены по пакетам с общим scope `@griha/*`.

```
grihaAi/
├── apps/
│   ├── agent/                    # ГЛАВНОЕ приложение: pi extensions + src + tests
│   │   ├── .pi/extensions/       # все расширения (core-agent, first-run-setup, sqlite-rag-memory,
│   │   │                         #   multi-agent, cron, model-router, personal-learning,
│   │   │                         #   telegram-bot, user-rules, gateway, report-generator,
│   │   │                         #   approval-gate, commitment-tracking, voice-intake,
│   │   │                         #   proactive-assistant, finance, crm, travel, connector)
│   │   ├── src/types, src/utils  # agent-only типы и утилиты
│   │   └── scripts/stt_local.py  # голосовой STT (faster-whisper, офлайн) + requirements.txt
│   └── api/                      # Hono: /health + /transcribe (STT) + /admin (auth через adminApiKey)
├── packages/
│   ├── shared-types/             # общие доменные типы (@griha/shared-types)
│   ├── config/                   # ~/.grish-ai config helpers (@griha/config)
│   ├── skills/                   # канонический skills-контент + registry (@griha/skills)
│   ├── stt/                      # voice transcription client (@griha/stt)
│   └── tsconfig/                 # общие base/node tsconfig (@griha/tsconfig)
├── package.json                  # private: true, npm workspaces
├── turbo.json
└── docs/                         # эта документация
```

**Правило импортов**: между пакетами — только `@griha/*` (`@griha/config`, `@griha/shared-types`, `@griha/skills`, `@griha/stt`); запрещены относительные пути в `packages/`. Внутри `apps/agent` относительные пути (`../../../src/...`, `../core-agent/...`) сохранены.

**Запуск**: агент стартует из `apps/agent` (`cd apps/agent && ../../node_modules/.bin/pi`), потому что pi читает `.pi/extensions` относительно cwd; skills агент берёт из пакета `@griha/skills` (`packages/skills/skills`). Перед запуском/тестами пакеты `@griha/*` должны быть собраны (`npm run build`), т.к. их `exports` указывает на `dist/`.


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
agent_end → getLastAssistantText() + takeSessionFile(sessionId)
        │   └─ ответ { text, filePath? }
        ▼
sender(chatId, text, filePath?) → sendMessage + (filePath ? sendDocument : ничего)
```

Сгенерированные файлы (`generate_report`/`generate_presentation`) доходят до пользователя как документ: инструмент регистрирует путь в per-session registry (`src/utils/telegram/session-files.ts`), пул забирает его на `agent_end`.

Полный разбор бота — в [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md).

Транспорт к Telegram устойчив к блокировкам отдельных IP РКН: кастомная `fetch`
(`apps/agent/.pi/extensions/telegram-bot/telegram-network.ts`, синглтон
`sharedTelegramFetcher`) ходит на `api.telegram.org` напрямую через keep-alive
`https.Agent`, `createConnection` которого перебирает IP (порядок: sticky →
системный DNS → DoH-обнаруженные) и запоминает рабочий (sticky). Переобнаружение
IP — каждые 10 минут (`telegram-ips.ts`: системный DNS + DoH Google/Cloudflare,
seed-список `149.154.167.220`/`149.154.166.110` добавляется всегда); SNI и `Host`
сохраняются как `api.telegram.org`. Скачивание файлов (фото/документы/голос,
`src/utils/telegram/telegram-files.ts`) идёт через тот же синглтон. Старый
прокси-путь доступен только при `TELEGRAM_USE_PROXY=1`.

---

## 5. Конфигурация и секреты

### Файл конфига

Конфиг хранится **вне репозитория**: `~/.grish-ai/config.json`.

- Базовая директория по умолчанию — `~/.grish-ai`.
- Переменная `GRISH_AI_HOME` переопределяет базу (используется в тестах).

Пути считаются в `@griha/config` (`packages/config/src/index.ts`):

- `getConfigDir()` — `GRISH_AI_HOME ?? HOME ?? cwd`, плюс `.grish-ai`;
- `getConfigPath()` — `.../config.json`;
- `loadConfig()` — читает и валидирует (минимально: `version === 1`, `provider`, `model`);
- `saveConfig()` — пишет с отступами.

### Схема `GrishAiConfig` (`@griha/shared-types`, `packages/shared-types/src/index.ts`)

```ts
{
  version: 1,
  provider: GrishAiProvider,   // openai|anthropic|openrouter|google|xai|deepseek|custom
  model: string,
  apiKey?: string,             // можно не хранить, если ключ из env
  baseUrl?: string,            // обязательно для custom
  adminApiKey?: string,        // ключ для admin/STT HTTP API (apps/api)
  setupCompletedAt: string,    // ISO-дата
  telegram?: { botToken: string; allowedUserIds?: number[] },
  models?: { main?: ModelConfig; vision?: ModelConfig },   // Phase 10
  embedding?: EmbeddingConfig  // { provider, model, apiKey?, baseUrl? } — реальные эмбеддинги
}
```

### Секреты

- **API-ключ DeepSeek** и **Telegram-токен** лежат **только** в `~/.grish-ai/config.json` — вне репозитория.
- В репозитории **нет** `.env` и `.grish-ai/` (это в `.gitignore` вместе с `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `tests/.tmp-db/`).
- GitHub-репозиторий приватный; перед push обязательно убедиться, что секреты не попали (см. историю сессии).

---

## 6. Провайдеры, модели и bootstrap

Логика «включить модель и провайдера» вынесена в `src/utils/bootstrap/provider-bootstrap.ts` и переиспользуется:

- `first-run-setup` — основная сессия (`applyConfig`);
- `telegram-bot` и `multi-agent` (субагенты) — изолированные субсессии (инлайн `providerBootstrap` → `applyConfig`);
- `model-router` — регистрация ключа `models.vision` (`registerModelProvider`);
- `http-vision` / `http-learning` — резолв OpenAI-совместимого base URL (`resolveModelBaseUrl`).

Функция `applyConfig(pi, ctx, cfg)`:

1. Если провайдер `custom` — регистрирует кастомный endpoint (`api: "openai-completions"`, `baseUrl`, список из одной модели).
2. Иначе, если в конфиге есть `apiKey`, — `pi.registerProvider(cfg.provider, { apiKey })`.
3. Ищет модель через `ctx.modelRegistry.find(provider, modelId)`.
4. **Fallback для DeepSeek**: если модели нет во встроенном каталоге, регистрирует официальный endpoint `https://api.deepseek.com` с моделями `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` (vision).
5. `pi.setModel(model)` — активирует модель (возвращает `false`, если нет авторизации).

**Мелочь (критично)**: просто записать `process.env.DEEPSEEK_API_KEY = ...` **недостаточно** — pi перечитывает env только при старте. Поэтому ключ передаётся через `pi.registerProvider(name, { apiKey })`, что помечает провайдера как «авторизованного».

Дополнительно `provider-bootstrap.ts` экспортирует `registerModelProvider(pi, cfg)` (регистрация ключа `models.vision`) и `resolveModelBaseUrl(cfg)` (base URL с дефолтами deepseek/custom) — их используют vision/learning HTTP-вызовы.

---

## 7. Паттерны DI и тестируемости

Проект намеренно построен вокруг **инъекции зависимостей**, чтобы логику можно было тестировать без реального LLM и сети:

| Компонент | Что инжектируется | Реальная реализация | Эмуляция/заглушка |
|---|---|---|---|
| Память | `EmbeddingService` | `HttpEmbeddingService` (OpenAI-совместимый `/embeddings`, из `cfg.embedding`) | `HashingEmbeddingService` (детерминированный fallback) |
| Субагенты | `SubAgentRunner` | `createRealSubAgentRunner` (изолированный `AgentSession` по `subtreeSessionId`) | `emulatedRunner` (для юнит-тестов) |
| Cron | `CronRunner`, `CronChangeDetector` | `createRealCronRunner` (через `SubAgentRunner`), `createRealCronChangeDetector` (дифф `state_snapshot` в sqlite) | `emulatedRunner` (для юнит-тестов) |
| Vision | `VisionCaller` | `createHttpVisionCaller` (OpenAI-совместимый `/chat/completions` к `models.vision`) | `emulatedVision` (для юнит-тестов) |
| Обучение | `LearningLlm` | `createHttpLearningLlm` (OpenAI-совместимый `/chat/completions`, модель из конфига) | `emulatedLlm` (для юнит-тестов) |
| Telegram-бот | `TelegramBotFactory` (grammy `Bot`) | `new Bot(token)` | `FakeBot` в тестах |
| Telegram-сессии | `TelegramSessionFactory` | `createAgentSession` | `FakeAgentSession` в тестах |
| Роутер моделей | `ModelCaller` | — (не реализован, не используется в проде) | мок в тестах |
| Документы | `pdfSpecRenderFn`, `pptxWriteFn` | `@json-render/react-pdf` (`renderToFile`), pptxgenjs | fake-функции в тестах |

**`ModelCaller` — единственный незакрытый компонент таблицы.** Это интерфейс `ModelRouter.call(role, messages)` для прямого вызова текстовой модели (`models.main`/`models.vision`). В проде он **не реализован и не вызывается**: генерация текста идёт через `AgentSession` (цикл pi), а vision — через `createHttpVisionCaller` (обход `ModelRouter.call`; сам `ModelRouter` используется только как `getConfig("vision")`). Приоритет низкий: нужен лишь при появлении сценария прямого LLM-вызова вне агентского цикла — тогда достаточно реализовать `ModelCaller` через OpenAI-совместимый `/chat/completions` (по образцу `createHttpLearningLlm`).

**Правило**: `src/utils/**` — чистые функции без побочных эффектов (сгруппированы по доменам); `*.pi/extensions/*` — тонкие обёртки, которые связывают чистые утилиты с `pi`/`ctx`. Сервисы (`SqliteRagMemoryService`, `CronService`, `UserProfileService`, `ClientNotesService`) — классы с `init()`/`close()` и ленивой инициализацией.

Эмуляции в проде больше не используются — все реальные реализации подключены; `emulated*` остались только как инъекции для юнит-тестов без сети/времени.

---

## 8. Важные «мелочи» и подводные камни

Это список нюансов, которые легко пропустить при чтении кода:

1. **Env-ключи не перечитываются после старта.** Ключ нужно регистрировать через `pi.registerProvider(name, { apiKey })`, а не присваивать `process.env` (см. §6).
2. **DeepSeek может отсутствовать во встроенном каталоге.** Поэтому `applyConfig` делает fallback-регистрацию официального endpoint. Список моделей сверен с `node_modules/@earendil-works/pi-ai/dist/providers/data/deepseek.json`.
3. **`ORIGINAL_ENV_KEYS`** в `first-run-setup` — снимок `Object.keys(process.env)` на момент загрузки расширения. Используется, чтобы отличать «ключ уже был в shell» от «ключа нет» в мастере (не предлагать ввод, если ключ уже есть).
4. **SQLite синхронный, обёрнут в async.** `better-sqlite3` синхронный; все методы сервисов объявлены `async` ради единообразного интерфейса, но внутри всё выполняется синхронно (кроме `await embeddingService.embed(...)`).
5. **FTS5 синхронизируется триггерами.** Для каждой таблицы (`facts`, `messages`, `insights`, `client_notes`) есть внешняя FTS5-таблица `*_fts` и триггеры `*_ai/_ad/_au`, которые держат индекс в актуальности. Удаление/обновление использует спец-запись `'delete'`.
6. **Поиск: FTS → LIKE fallback.** `buildFtsQuery` разбивает запрос на токены (`"токен"*` через `AND`). Если FTS ничего не нашёл (или запрос пустой/ошибочный) — fallback на `LIKE` с экранированием `%_\\`.
7. **Эмбеддинги.** Реальная реализация — `HttpEmbeddingService` (OpenAI-совместимый `POST /embeddings`), конфигурируется через `cfg.embedding = { provider, model, apiKey, baseUrl? }` (в `@griha/shared-types`). Если `cfg.embedding` не задан — fallback на `HashingEmbeddingService` (детерминированный «hashing trick», dim=384), который остаётся для тестов без сети. Векторное расстояние теперь считает расширение **`sqlite-vec`** (`vec_distance_cosine` по BLOB-колонке float32), а не самодельный JS-косинус; при неудачной загрузке расширения — fallback на старый JS-косинус. Название embedding-модели не зашивается жёстко — сверяйся с актуальным каталогом провайдера (на момент проверки у OpenAI актуальна `text-embedding-3-small`).
8. **Гибридный поиск = RRF.** `reciprocalRankFusion` с `k=60` объединяет векторные и FTS-хиты; источник помечается `vector|fts|hybrid`.
9. **`adaptive-router.ts` подключён как pre-filter в `core-agent`.** В `before_agent_start` входящее сообщение классифицируется через `classifyComplexity`; для COMPLEX в system-prompt добавляется подсказка с готовым `buildDelegationPlan` (`buildRouterHint`). Вызов `delegate_tasks` **не форсируется** — агент сам решает, использовать план или выполнить задачу сам. Для SIMPLE подсказка не добавляется и LLM-оркестратор не дёргается.
10. **`tests/setup.ts` только создаёт папку, не удаляет.** Тесты идут параллельными процессами; общий `rm` гонялся и ломал чужие БД. Поэтому в `before()` только `mkdir`, а каждый тест использует уникальное имя БД (`getTestDbPath(name)`).
11. **Телеграм: ACL теперь через `users.json`, не только `allowedUserIds`.** Источник правды —
    `~/.grish-ai/users.json` (UsersService): owner/admin/user/blocked, правки без рестарта.
    Режим для неизвестных: `config.aclMode` ?? (`ownerUserId`/`allowedUserIds` заданы ? `closed` : `open`).
    Пустой whitelist без owner ⇒ **open** (пускает всех) — это осознанный dev-дефолт, а не блок всех.
    См. docs/TELEGRAM-BOT.md §9 «Users ACL».
12. **Телеграм `/new` сбрасывает изолированную сессию.** `TelegramBridge` зовёт `resetHandler` → `TelegramSessionPool.reset(userId)`: текущий `AgentSession` закрывается (`dispose()`), новый с чистым `sessionId` создаётся лениво на следующем сообщении. Файлы старой сессии не удаляются; личная память/правила/профиль не затрагиваются (сброс диалога, не профиля).
13. **Команда `git`/публикация**: репозиторий приватный, коммит без секретов (см. `README` → «Конфигурация и секреты»). `gh` на машине не был авторизован на момент подготовки.
14. **Ранжирование памяти: bm25 + cosine + RRF + recency.** Скор — `bm25` (FTS), `1 − vec_distance_cosine` (sqlite-vec) и гибридный RRF (`k=60`); к итоговому скору применяется recency-фактор (экспоненциальное затухание, период полураспада 30 дней, не опускается ниже 0.5) — свежий факт выигрывает при равной релевантности, старое не «хоронится». Важности/confidence в скоре нет. Удаление — `deleteFact(id)` (инструмент `memory_delete`), дедупликация — `addFact` обновляет существующую запись вместо создания дубля при почти точном совпадении в той же категории/scope.
15. **Векторный поиск — полный скан.** ANN-индекса нет; на 100k записей гибридный поиск ~125 мс, FTS-индекс занимает ~92% размера БД. Замеры и дерево решений по масштабу — в аудите памяти: [docs/archive/MEMORY-AUDIT-2026-09.md](archive/MEMORY-AUDIT-2026-09.md).
16. **Хеш-эмбеддинги — фолбэк, не семантика.** Без `cfg.embedding` используется лексический `HashingEmbeddingService` (dim=384): точный/фильтрованный поиск работает, парафразы — нет. Для семантики включить `cfg.embedding` (см. §7).

---

## 9. Генерация документов (report-generator)

Расширение `report-generator` генерирует PDF/PPTX по **фиксированным макетам** — LLM только подставляет данные в готовый layout и **не может** его менять. Это принципиально: цифры попадают в одно и то же место в каждом отчёте.

- **Spec-билдеры**: `src/utils/reports/report-specs.ts` — три builder-функции (`buildSalesReportSpec`, `buildExpenseReportSpec`, `buildMeetingMinutesSpec`), каждая собирает json-render-спек из **фиксированного каталога компонентов** (`@json-render/react-pdf`: Document, Page, Heading, Text, Table, List, Divider, Spacer). Это структурная (не только промптная) гарантия: каталог компонентов физически не допускает произвольной вёрстки — LLM может только заполнить готовые слоты. Структура и данные сохранены от прежних HTML-шаблонов (период, итоговая сумма крупно, таблица категорий, топ-сделки / список трат / участники-повестка-решения), палитра (`#1f3864`, `#555555`, `#1a1a1a`, `#dddddd`) перенесена из CSS-переменных старых шаблонов.
- **Схемы данных**: `src/utils/reports/report-schemas.ts` (TypeBox) — строгая валидация **до** рендера через `typebox/value` (`Check`/`Errors`). Невалидные данные → понятная ошибка инструмента, а не кривой PDF с пропущенными полями. Этот шаг не менялся.
- **Рендер**: `src/utils/reports/report-renderer.ts`:
  - `renderPdfReport(type, data, options)` — собирает spec через builder из п.2 и зовёт `renderToFile(spec, outputPath)` из **@json-render/react-pdf** (внутри — `@react-pdf/renderer`). Рендер в чистом Node, **без headless-браузера** — никакого Chromium, integration-тест гоняется в обычном CI;
  - `renderPresentation(slides, options)` — PPTX через **pptxgenjs** (путь без изменений; у json-render нет pptx-таргета), один фиксированный slide-master (шапка-заголовок, единый шрифт/цвета); данные — просто массив `{ title, bullets[] }`.
- **Инструменты**: `generate_report(reportType, data)` и `generate_presentation(slides)`. Параметра `style`/`layout` **нет намеренно** — это гарантия однотипности, а не случайное ограничение. Оба возвращают путь к файлу в `details` и регистрируют его в per-session registry (`src/utils/telegram/session-files.ts`, `setSessionFile`) через `ctx.sessionManager.getSessionId()`.
- **Доставка в Telegram**: `TelegramSessionPool.runPrompt` на `agent_end` забирает файл (`takeSessionFile`) и возвращает `{ text, filePath? }`; бот доставляет текст как обычно, а при наличии файла — `sendDocument` (grammy `InputFile`). Подробности — [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md).
- **DI**: `pdfSpecRenderFn`/`pptxWriteFn` инжектируемы (тот же паттерн, что у `HttpEmbeddingService`/`fetchFn`) — unit-тесты проверяют структуру spec-дерева без реального рендера, подменяя `renderToFile`/pptxgenjs; integration-тест рендерит настоящий PDF через `@react-pdf/renderer`.
- **Путь вывода**: `~/.grish-ai/reports/<uuid>.pdf|.pptx`.

---

## 10. Фактическая карта компонентов

### Ответственность расширений

| Компонент | Ответственность |
|---|---|
| `first-run-setup` | Мастер настройки провайдера/модели/ключа |
| `core-agent` | System-prompt: skills, политика делегирования, language policy, router-hint. `/skills`. **Тонкий** — не God Object |
| `sqlite-rag-memory` | Гибридная память (facts/messages/insights) + ClientNotes + UserProfile |
| `multi-agent` | Делегирование, BotRegistry, SubAgentManager, Shared Insights |
| `cron` | Планировщик (CronService) + real runner/change-detector |
| `model-router` | main/vision-маршрутизация + `analyze_image` |
| `personal-learning` | Профиль, заметки, авто-дообучение, skill proposals (review-gated) |
| `telegram-bot` | Long polling + изолированные AgentSession на пользователя |
| `user-rules` | hard/soft-правила + prefilter + инъекция + Telegram-контекст |
| `gateway` | Единая блокировка side-effect tool-calls (trusted/untrusted) |
| `report-generator` | PDF/PPTX по фикс. шаблонам |
| `approval-gate` | Approval-запросы + финансовые пороги |
| `commitment-tracking` | Обязательства (structured state) |
| `voice-intake` | `transcribe_voice` (STT) + confidence-гейт |
| `proactive-assistant` | Календарь, брифинг, аномалии, meeting_prep/contact_briefing |
| `finance` | Расходы/счета/категоризация/сводка |
| `crm` | Контакты |
| `travel` | Поездки |
| `connector` | Capability report |

### Где хранится state

| Хранилище | Файл | Владелец |
|---|---|---|
| Memory (facts/messages/insights) | `~/.grish-ai/memory.sqlite` | sqlite-rag-memory |
| Client notes / User profile | `memory.sqlite` (таблицы) | sqlite-rag-memory |
| Cron jobs/runs | `memory.sqlite` (таблицы cron_*) | cron |
| Commitments | `commitments.sqlite` | commitment-tracking |
| Approvals / policies | `approvals.sqlite` | approval-gate |
| Calendar events | `calendar.sqlite` | proactive-assistant |
| Anomalies | `anomalies.sqlite` | proactive-assistant |
| Briefing runs (dedupe) | `briefings.sqlite` | proactive-assistant |
| Expenses / invoices | `finance.sqlite` | finance |
| Contacts | `contacts.sqlite` | crm |
| Travel items | `travel.sqlite` | travel |
| User rules | `user-rules.sqlite` | user-rules |

**Разделение**: Memory (знания/контекст) и Structured State (операционное состояние)
хранятся в разных сущностях, но cron-таблицы и client notes живут в `memory.sqlite`
вместе с памятью.

### Бэкапы SQLite

- **Что**: все `~/.grish-ai/*.sqlite` (memory, approvals, commitments, finance, contacts, travel, anomalies, user-rules и др.).
- **Как**: `apps/agent/scripts/backup.ts` — для каждой БД делает консистентный снимок через `VACUUM INTO` (безопасно при открытой БД и WAL; голый `cp` поверх WAL не использовать). Снимки — в `~/.grish-ai/backups/<ISO-дата-время>/`, права 0600/0700.
- **Ротация**: хранятся последние 7 бэкапов (`BACKUP_KEEP`), старые удаляются.
- **Когда**: systemd-таймер `deploy/griha-ai-backup.timer` + `.service` — раз в сутки (03:00), независимо от того, запущен ли агент (не cron-расширение).
- **Восстановление**: остановить агента (`systemctl --user stop griha-ai.service`), скопировать нужный `*.sqlite` из `~/.grish-ai/backups/<timestamp>/` обратно в `~/.grish-ai/` (WAL/shm-файлы не нужны — VACUUM INTO даёт цельный файл), запустить агента.

### Где выполняются side effects

- `gateway` (`tool_call`) — блокирует shell/мутацию для untrusted.
- `invoice_set_status("paid")` — финансовое действие, проверяет approval policy.
- Telegram `sendDocument`/`sendMessage` — реальная отправка.
- Остальные инструменты — внутренние мутации (SQLite), без внешнего эффекта.

Внешних connectors (gmail/calendar/travel/crm/accounting) **нет** — только
connector-ready boundary (`src/utils/capabilities.ts`).

### Где принимаются permission decisions

- `gateway` — техническая граница (trust level).
- `approval-gate` (`src/utils/finance/approval-policy.ts`) — классификация действия +
  финансовые пороги; у запросов есть `scope` (default `ONCE`, политики `global|chat`)
  и статусы `pending|approved|rejected|cancelled|expired`.
- `user-rules` prefilter — hard-правила «отвечай только мне».

### Routing

- `adaptive-router` (`classifyComplexity`) → SIMPLE/COMPLEX → `delegate_tasks` (подсказка, не принуждение).
- `model-router` → main/vision.
- Skill-выбор — через system-prompt (`core-agent` инжектирует список skills); LLM выбирает skill, отдельного «skill router» как компонента нет.

### Context

Контекст собирается в **`src/context/ContextBuilder.ts`** — единой точке агрегации:
skills спрашивают контекст у билдера, а не сканируют память сами. Параллельно
`core-agent` (skills+политики), `personal-learning` (профиль+заметки) и `user-rules`
(правила+Telegram-контекст) дописывают свои части system-prompt в
`before_agent_start`; `meeting_prep`/`contact_briefing` собирают контекст точечно через билдер.

### Переиспользуемые механизмы

- `provider-bootstrap` (`applyConfig`) — провайдер/модель (см. §6).
- DI-паттерн (fetch/render/runner/фабрики бота) — для тестов (см. §7).
- per-session registry (`session-files.ts`, `user-rules/context.ts`).
- SQLite-service паттерн (`init()`/`close()`, WAL).

---

## 11. Слоистая модель и domain contracts

Целевая слоистая модель (границы ответственности, а не построчная реализация):

```
Transport            → telegram-bot (long polling + изолированные сессии)
Session / Identity   → sessionId + per-session context (user-rules/context.ts)
Core Agent           → pi runtime + core-agent system-prompt (оркестратор)
Skill Router         → список skills в system-prompt (LLM выбирает capability)
Context Builder      → src/context/ContextBuilder.ts (единая сборка контекста)
Policy / Approval    → gateway (технич.) + approval-policy + approval-gate
Workflow             → src/workflow/workflows.ts (meeting / finance)
Domain Services      → CommitmentService, FinanceService, CalendarService, …
Tools / Cron / Providers → tools, deterministic cron tasks, provider-интерфейсы
Persistence          → SQLite-сервисы (WAL)
```

Отдельные сквозные механизмы: Memory (знания/контекст), Structured State
(операционное состояние), Capabilities, Policies, Approvals, Events.

### Ключевые разделения

1. **Memory ≠ Structured State.** Memory (`memory.sqlite`: facts/messages/insights)
   хранит знания и историю. Structured State (commitments/expenses/invoices/
   contacts/events/anomalies/approvals) — отдельные SQLite-файлы (исключения:
   cron и client notes в `memory.sqlite`, см. §10).
2. **Gateway ≠ Policy ≠ Approval.**
   - Gateway — техническая граница (`tool_call`, trusted/untrusted).
   - Policy — разрешено ли действие пользователю в контексте (financial thresholds,
     user rules с `ruleClass`).
   - Approval — существует ли действующее явное подтверждение
     (`scope: ONCE|SESSION|WORKFLOW`, статусы `pending|approved|rejected|expired|cancelled`).
   - Поток: Agent → Capability Check → Policy Check → Approval Check → Execute / Reject / Ask.
3. **Capability Registry** — единый источник возможностей (`src/utils/capabilities.ts`,
   статусы `AVAILABLE|UNAVAILABLE|REQUIRES_CONNECTION|REQUIRES_APPROVAL`).
4. **ContextBuilder** — skills не сканируют всю память; контекст собирается в одном месте.
5. **Workflow** — координирует шаги; skill = capability; service = business logic;
   provider = внешняя система.

### Domain contracts

`src/types/domain.ts` — канонические контракты:

- **Commitment** — `id, userId, actor, action, target, deadline, status, source,
  sourceMessageId, meetingId, contactId, confidence, completedAt`. Статусы
  `open|due_soon|overdue|completed|cancelled` (due_soon/overdue выводятся из deadline).
- **Approval** — `id, userId, sessionId, action, actionClass, target, args, scope,
  status, expiresAt`. Scope `ONCE|SESSION|WORKFLOW`.
- **Anomaly** — `type, severity, detectedAt, explanation, evidence, status`.
- **Briefing** — `userId, dayKey, text, ranAt` (dedupe по user+day).
- **Meeting / CalendarEvent** — `kind: meeting|event|focus|other`.
- **Contact** — identity + tags + lastInteraction + provenance (notes отдельно).
- **Invoice / Expense** — финансы (`FinanceService`).
- **Task** — единица работы субагента/cron.

### Providers

`src/providers/providers.ts` — интерфейсы `CalendarProvider`, `EmailProvider`,
`CRMProvider`, `TravelProvider`, `AccountingProvider`. Сейчас все — `noop`
(возвращают `ok:false` + описание лимита), кроме локального `email.draft`.
Реальные API не подключены; fake success запрещён.

### Sub-agent capabilities

`src/capabilities/subagent-capabilities.ts` — явный allowlist. Субагенты
(untrusted) могут только `memory.search`, `ocr.process`, `report.pdf`, `report.pptx`.
Запрещены write/side-effect/approval-gated capabilities.

### Deterministic cron

`src/cron/deterministic-tasks.ts` — cron сначала выполняет детерминированные
запросы к сервисам (`daily-briefing`, `anomaly-scan`, `commitment-due-scan`),
и только потом LLM синтезирует. Cron никогда не просит LLM «прочитать всю память».

### Learning guard

`src/utils/learning/skill-improver.ts` (`isProtectedSkillContent`) — авто-дообучение
не предлагает/не применяет изменения в domains: security, approval, permission,
restriction, financial policy/limits. Protected skill names:
`human-approval-gate`, `approval-thresholds`, `privacy-data-hygiene`, `delegation-triage`.

---

## Смежные документы

- [docs/EXTENSIONS.md](EXTENSIONS.md) — пофайловый справочник (типы, утилиты, каждое расширение, все инструменты и команды).
- [docs/SKILLS.md](SKILLS.md) — живой каталог skills + workflow graphs.
- [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md) — глубокий разбор Telegram-бота и пула изолированных сессий.
- [docs/SECURITY.md](SECURITY.md) — периметр, модель доверия, gateway, policy, approval и sandbox-слои.
- [docs/archive/](archive/) — история: аудиты и отчёты завершённых фаз (не актуальное состояние).
- [STATUS.md](../STATUS.md) — прогресс по фазам.
