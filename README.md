# griha-ai

Агент **Гриша** — самостоятельный TypeScript-агент на платформе **pi.dev**: замкнутый цикл обучения, слоистая память, именованный Bot Mode, автономное создание skills.

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
npm install               # workspace-зависимости
npm run typecheck         # turbo: typecheck всех пакетов (собирает @griha/*)
npm test                  # turbo: тесты агента (208 unit)
npm run build             # turbo: сборка пакетов в dist/

# Запуск агента — из apps/agent (pi читает .pi/ и skills/ оттуда):
cd apps/agent
../../node_modules/.bin/pi
# В pi при первом запуске откроется мастер настройки:
#   провайдер → модель → API-ключ (или /setup повторно)
```

## Как это устроено (кратко)

Вся бизнес-логика — **расширения pi.dev** в `apps/agent/.pi/extensions/`. Каждое расширение — файл `index.ts` с `export default function (pi: ExtensionAPI)`, который подписывается на события агента, регистрирует LLM-инструменты и slash-команды.

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
| `user-rules` | Правила (hard/soft) + pre-filter и инъекция в system-prompt |
| `gateway` | Блокировка side-effect tool-calls для untrusted-сессий (defense-in-depth) |
| `report-generator` | PDF/PPTX по фиксированным шаблонам (`generate_report`, `generate_presentation`) |
| `approval-gate` | Подтверждение side-effect/high-risk действий (`approval_required`) + финансовые пороги |
| `commitment-tracking` | Обязательства (`commitment_*`), статусы due_soon/overdue из dueDate |
| `voice-intake` | Транскрипция голоса (`transcribe_voice`) + confidence-гейт |
| `proactive-assistant` | Брифинг (`briefing_generate`), календарь (`event_*`), аномалии, meeting_prep |
| `finance` | Расходы/счета/категоризация/сводка (`expense_*`, `invoice_*`, `finance_summary`) |
| `crm` | Контакты (`contact_*`) + client notes |
| `travel` | Поездки (`travel_*`), маршрут, upcoming |
| `connector` | Capability report (`capabilities_list`) — connector-ready boundary |

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Структура (Turborepo + Hono)

```
grihaAi/
├── apps/
│   ├── agent/                # главный агент (pi extensions, telegram, memory)
│   │   ├── .pi/extensions/   # все расширения (вся бизнес-логика)
│   │   ├── src/              # types + utils (agent-only)
│   │   ├── scripts/stt_local.py  # голосовой STT (faster-whisper, офлайн) + requirements.txt
│   │   └── tests/
│   ├── api/                  # Hono: /health + /transcribe (STT) + /admin (auth)
├── packages/
│   ├── shared-types/         # общие TS-типы (@griha/shared-types)
│   ├── config/               # ~/.grish-ai config helpers (@griha/config)
│   ├── skills/               # канонический skills-контент + registry (@griha/skills)
│   ├── stt/                  # voice transcription client (@griha/stt)
│   └── tsconfig/             # общие base/node tsconfig (@griha/tsconfig)
├── package.json              # private: true, npm workspaces
├── turbo.json
├── docs/                     # документация
│   ├── ARCHITECTURE.md       # общая картина, платформа, «мелочи»
│   ├── EXTENSIONS.md         # пофайловый справочник
│   ├── TELEGRAM-BOT.md       # глубокий разбор бота
│   └── SECURITY.md           # периметр, модель доверия, gateway, sandbox
└── README.md / STATUS.md
```

Правила: импорты между пакетами только через `@griha/*` (не через относительные пути в `packages/`). Один менеджер пакетов на репу (npm).

## Команды

```bash
npm install       # workspace-установка
npm run build     # turbo run build
npm run typecheck # turbo run typecheck
npm test          # turbo run test
```

Внутри пакета (например, `apps/agent`):

```bash
npm run typecheck # tsc --noEmit
npm test          # tsx --test tests/**/*.test.ts
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

В Telegram: `/start`, `/status`, `/new`. Каждый пользователь получает **изолированную сессию Гриши** (свой `sessionId`). Сгенерированные файлы (`generate_report`/`generate_presentation`) приходят обратно как документ (`sendDocument`). Разбор — [docs/TELEGRAM-BOT.md](docs/TELEGRAM-BOT.md).

## Ограничения проекта

- Платформа: только pi.dev, весь код на TypeScript.
- Хранилище: только sqlite-rag / sqlite.ai (better-sqlite3 + FTS5).
- Исключено: биллинг, монетизация, платёжный трекинг, генерация траекторий для обучения/продажи.

## Документация для передачи другому агенту

Рекомендуемый порядок чтения:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — как устроено, платформа, события, конфиг, секреты, все «мелочи».
2. [docs/EXTENSIONS.md](docs/EXTENSIONS.md) — пофайловый справочник (типы, утилиты, каждое расширение, все инструменты и команды).
3. [docs/TELEGRAM-BOT.md](docs/TELEGRAM-BOT.md) — бот и изоляция сессий.
4. [docs/SECURITY.md](docs/SECURITY.md) — периметр, модель доверия, gateway и sandbox-слои.
5. [docs/GRISHA_SKILLS.md](docs/GRISHA_SKILLS.md) — канонический каталог 25 skills + workflow graphs.
6. [docs/DOMAIN-ARCHITECTURE.md](docs/DOMAIN-ARCHITECTURE.md) — целевая слоистая модель (ContextBuilder/Workflow/Providers/Capabilities).
7. [docs/CURRENT_ARCHITECTURE.md](docs/CURRENT_ARCHITECTURE.md) — аудит текущей архитектуры.
8. [docs/GRISHA_SKILL_CAPABILITY_MATRIX.md](docs/GRISHA_SKILL_CAPABILITY_MATRIX.md) — аудит и gap-классификация.
9. [docs/GRISHA_SKILLS_FINAL_REPORT.md](docs/GRISHA_SKILLS_FINAL_REPORT.md) — финальный QA-отчёт.
10. [STATUS.md](STATUS.md) — прогресс по фазам.
