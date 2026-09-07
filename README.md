# grish-ai

Агент **Гриша** — TypeScript-переписывание ключевых возможностей **Nous Research Hermes Agent** поверх платформы **pi.dev** (версия Hermes 2026): замкнутый цикл обучения, слоистая память, именованный Bot Mode, автономное создание skills.

## Роль агента

Профессиональный ассистент **менеджера / секретаря / бухгалтера** — расписания, документы, отчёты, переписка, исследования, заметки со встреч, лёгкая финансовая поддержка. Инструменты программирования — вторичны.

## Стек

- **Платформа**: [pi.dev](https://pi.dev) — `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` (v0.85.1)
- **Язык**: TypeScript (strict, NodeNext/ESM, target ES2022)
- **Память**: `better-sqlite3` + FTS5 (гибридный поиск: FTS + вектора)
- **Telegram**: `grammy` (long polling)
- **Тесты**: `node:test` через `tsx`

## Быстрый старт

```bash
npm install               # зависимости
npm run typecheck         # строгая проверка типов
npm test                  # 63 теста (unit)
./node_modules/.bin/pi    # запустить агента (CLI pi)

# В pi при первом запуске откроется мастер настройки:
#   провайдер → модель → API-ключ (или /setup повторно)
```

## Как это устроено (кратко)

Вся бизнес-логика — **расширения pi.dev** в `.pi/extensions/`. Каждое расширение — файл `index.ts` с `export default function (pi: ExtensionAPI)`, который подписывается на события агента, регистрирует LLM-инструменты и slash-команды.

| Расширение | Что даёт |
|---|---|
| `first-run-setup` | Мастер настройки провайдера/модели/ключа (`/setup`, `/model`) |
| `core-agent` | Skills + политика делегирования + закрытый цикл обучения в system-prompt |
| `sqlite-rag-memory` | Гибридная память (`memory_add`, `memory_search`) |
| `multi-agent` | Делегирование, боты, субагенты, Shared Insights |
| `cron` | Планировщик задач с continuity и monitorMode |
| `model-router` | Маршрутизация main/vision + `analyze_image` |
| `personal-learning` | Профиль пользователя, заметки, авто-дообучение |
| `telegram-bot` | Telegram-бот (long polling) + изолированные сессии на пользователя |

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Структура проекта

```
grish-ai/
├── package.json / tsconfig.json
├── .pi/
│   ├── settings.json          # какие расширения и skills грузить
│   └── extensions/            # расширения (вся бизнес-логика)
│       ├── core-agent/  first-run-setup/  sqlite-rag-memory/
│       ├── multi-agent/  cron/  model-router/
│       ├── personal-learning/  telegram-bot/
├── skills/core/SKILL.md       # базовый skill (agentskills.io frontmatter)
├── src/
│   ├── types/                 # TypeBox-схемы и TS-типы
│   └── utils/                 # чистые утилиты (config, skills, embeddings, роутеры…)
├── tests/
│   ├── unit/                  # 13 тест-файлов (node:test)
│   ├── integration/           # зарезервировано
│   └── setup.ts
├── docs/                      # документация
│   ├── ARCHITECTURE.md        # общая картина, платформа, «мелочи»
│   ├── EXTENSIONS.md          # пофайловый справочник
│   └── TELEGRAM-BOT.md        # глубокий разбор бота
└── README.md / STATUS.md
```

## Команды npm

```bash
npm install       # зависимости
npm run build     # компиляция в dist/
npm test          # tsx --test tests/**/*.test.ts
npm run typecheck # tsc --noEmit (strict)
```

## Конфигурация и секреты

- Конфиг: `~/.grish-ai/config.json` (переопределяется `GRISH_AI_HOME`).
- **Секреты** (API-ключ, Telegram-токен) лежат **только там**, вне репозитория.
- В `.gitignore`: `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `.env`, `tests/.tmp-db/`, `.grish-ai/`.
- GitHub-репозиторий приватный; коммит без секретов.

## Telegram-бот (long polling)

```bash
# 1. @BotFather → создать бота, получить токен
# 2. В pi:
/telegram-setup        # токен + whitelist user_id через запятую
/telegram-status       # статус (токен, whitelist, polling, активные сессии)
/telegram-start        # запустить long polling
/telegram-stop         # остановить long polling
```

В Telegram: `/start`, `/status`, `/new`. Каждый пользователь получает **изолированную сессию Гриши** (свой `sessionId`). Разбор — [docs/TELEGRAM-BOT.md](docs/TELEGRAM-BOT.md).

## Ограничения проекта

- Платформа: только pi.dev, весь код на TypeScript.
- Хранилище: только sqlite-rag / sqlite.ai (better-sqlite3 + FTS5).
- Исключено: биллинг, монетизация, платёжный трекинг, генерация траекторий для обучения/продажи.

## Документация для передачи другому агенту

Рекомендуемый порядок чтения:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — как устроено, платформа, события, конфиг, секреты, все «мелочи».
2. [docs/EXTENSIONS.md](docs/EXTENSIONS.md) — пофайловый справочник (типы, утилиты, каждое расширение, все инструменты и команды).
3. [docs/TELEGRAM-BOT.md](docs/TELEGRAM-BOT.md) — бот и изоляция сессий.
4. [STATUS.md](STATUS.md) — прогресс по фазам.
