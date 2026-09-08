# Пофайловый справочник

> **Это единственный живой источник правды по пофайловому справочнику (типы/утилиты/расширения); `docs/archive/` содержит только историю, не актуальное состояние.**

Детальный разбор каждого файла проекта. Идеален для быстрого поиска «где что лежит и что делает». Читать вместе с [ARCHITECTURE.md](ARCHITECTURE.md).

---

## `src/types/` — общие типы и TypeBox-схемы

### `src/types/config.ts`

Конфигурация приложения:

- `GrishAiProvider` — union провайдеров: `openai | anthropic | openrouter | google | xai | deepseek | custom`.
- `ModelConfig` — `{ provider, model, apiKey?, baseUrl? }` (используется для `models.main` / `models.vision`).
- `GrishAiConfig` — корневая схема (см. [ARCHITECTURE.md §5](ARCHITECTURE.md#5-конфигурация-и-секреты)).
- `TelegramConfig` — `{ botToken, allowedUserIds? }`.

### `src/types/index.ts`

Доменные типы и TypeBox-схемы для инструментов:

- `MemoryFact` — durable-факт памяти; категории `preference | fact | procedure | insight | user_profile | decision | other`; поле `embedding?: number[] | Float32Array | Buffer`.
- `SessionMessage` — сообщение сессии для кросс-сессионного FTS-поиска.
- `SkillMeta` — метаданные skill (agentskills.io): `name, description, path, version?, tags?, autoCreated?`.
- `BotConfig` — именованный специализированный бот (Bot Mode).
- `SearchResult` — результат поиска `{ id, content, score, source: "vector"|"fts"|"hybrid", metadata? }`.
- `MemoryAddSchema` / `MemorySearchSchema` — TypeBox-схемы параметров инструментов памяти.
- Фаза 5 (делегирование): `TaskComplexity`, `SubAgentTask`, `SubAgentStatus`, `SharedInsight`, `DelegationPlan`.
- Фаза 6 (steering): `SubAgentState`, `SteerCommand`.
- Фаза 7 (cron): `CronJob`, `CronRunRecord`.
- Фаза 9 (обучение): `UserProfile`, `ClientNote`.

---

## `src/utils/` — чистые утилиты

Утилиты сгруппированы по доменам (`src/utils/<домен>/<файл>.ts`). Файлы, не
вписывающиеся ни в один домен (например `capabilities.ts`), лежат на верхнем
уровне `src/utils/`.

### `src/utils/config.ts`

Чтение/запись `~/.grish-ai/config.json`:

- `CONFIG_DIR_NAME = ".grish-ai"`, `CONFIG_FILE_NAME = "config.json"`.
- `getConfigDir()` — `GRISH_AI_HOME ?? HOME ?? cwd` + `.grish-ai`.
- `configExists()`, `loadConfig()` (с минимальной валидацией), `saveConfig(cfg)` (создаёт каталог при необходимости).

### `src/utils/bootstrap/provider-bootstrap.ts`

Общий bootstrap моделей (переиспользуется first-run-setup и telegram-bot):

- `CUSTOM_BASE_URL_DEFAULT`, `DEEPSEEK_BASE_URL`.
- `makeModel(id, name?, {vision?})` — собрать `ProviderModelConfig`.
- `registerCustomProvider(pi, cfg)` — кастомный OpenAI-совместимый endpoint.
- `registerDeepSeekProvider(pi, cfg)` — официальный DeepSeek endpoint + 3 модели (одна vision).
- `applyConfig(pi, ctx, cfg)` — основной сценарий (см. [ARCHITECTURE.md §6](ARCHITECTURE.md#6-провайдеры-модели-и-bootstrap)).

### Skills discovery — `@griha/skills`

Обнаружение и форматирование skills вынесено в пакет **`packages/skills`** (`@griha/skills`) — единственный источник контента и registry API:

- `getSkillsRoot()` — абсолютный путь к `packages/skills/skills`.
- `discoverSkills(rootDir?)` — рекурсивный обход (по умолчанию `getSkillsRoot()`): каталог с `SKILL.md` — корень skill (не рекурсируем); иначе прямые `.md`-файлы — skills; подкаталоги — рекурсия.
- `formatSkillsForPrompt(skills)` — строки вида `- name (autoCreated, v1): description`.
- `parseFrontmatter` — минимальный line-based парсер (без зависимости от pi).

Старый `apps/agent/src/utils/skills.ts` удалён. Контент — в `packages/skills/skills/<name>/SKILL.md`.

### `src/utils/finance/` — финансы

- `finance.ts`: `categorizeTransaction` (история → уточнение, без auto-apply на похожие), `summarizeExpenses`/`comparePeriods`, `parseExpenseFromOcr` (консервативно, не угадывает).
- `approval-policy.ts`: `classifyAction(action)` (READ_ONLY / REVERSIBLE_LOW_RISK / SIDE_EFFECT / HIGH_RISK_IRREVERSIBLE), `requiresApproval(action, {amount, category, policy})` — финансовые пороги. Чистая, тестируется.
- `anomaly-detect.ts`: `detectCommitmentOverdue`, `detectDuplicateInvoices`, `detectExpenseOutliers` (baseline × threshold + explanation). Чистые, без persistence.

### `src/utils/memory/` — память

- `embeddings.ts`: интерфейс `EmbeddingService` (`embed`, опционально `embedBatch`); `HashingEmbeddingService(dim=384)` — детерминированный «hashing trick» (FNV-1a, бакет, знак, L2-норма). **Плейсхолдер** — точка замены на нейронную модель.
- `http-embeddings.ts`: `HttpEmbeddingService` — OpenAI-совместимый `POST /embeddings`.

### `src/utils/learning/` — обучение

- `learning-extractor.ts`: `extractLearning(dialog, llmCall)` — JSON `{facts, preferences, notes}`; `applyLearning`, `isExtractionEmpty`, `summarizeExtraction`.
- `http-learning.ts`: `createHttpLearningLlm` — OpenAI-совместимый `/chat/completions` для дообучения.
- `skill-improver.ts`: предложение правки `core/SKILL.md` или нового skill (`autoCreated: true`) через LLM; review-gated — применяется только после `ctx.ui.confirm`, иначе `pending`.
- `personal-context.ts`: `formatPersonalContext(profile, notes)` — компактный блок `## Профиль пользователя` / `## Заметки` для system-prompt.

### `src/utils/vision/` — vision

- `http-vision.ts`: `createHttpVisionCaller` — `/chat/completions` к `models.vision`.
- `image-analyzer.ts`: `analyzeImage(params, vision, visionConfig)`, `runAnalyzeImage(config, params, vision)` — gate на наличие vision-конфига, возвращает `{ ok, text }`.

### `src/utils/reports/` — отчёты

- `report-schemas.ts`: TypeBox-схемы данных отчётов (`SalesReportSchema`, `ExpenseReportSchema`, `MeetingMinutesSchema`), `ReportTypeSchema`, `REPORT_SCHEMAS`. Валидация (`Check`/`Errors`) — **до** рендера.
- `report-renderer.ts`: `renderHtml` (Handlebars), `renderPdfReport` (Playwright), `renderPresentation` (pptxgenjs). DI: `pdfRenderFn`/`pptxWriteFn` инжектируемы для тестов. Шаблоны — `../.pi/extensions/report-generator/templates/` относительно файла.

### `src/utils/telegram/` — Telegram-специфика

- `telegram-files.ts`: резолв `file_id` в base64 (`downloadTelegramFileAsBase64`) / на диск (`downloadTelegramFileToDisk`) через Bot API.
- `voice-intake.ts`: `assessTranscriptConfidence(result)` — эвристический confidence-гейт.
- `session-files.ts`: per-session outbox — `setSessionFile(sessionId, filePath, caption?)` / `takeSessionFileRecord`, `addSessionInlineButtons` / `takeSessionInlineButtons`. Связывает `report-generator`/`approval-gate` (кладут) и `TelegramSessionPool` (забирает на `agent_end`).

### `src/utils/routing/` — маршрутизация

- `adaptive-router.ts`: `classifyComplexity(message, llmCall?)` (эвристика: сигнальные слова, предложения, длина), `buildDelegationPlan(message, llmCall)` (JSON-оркестратор, fallback на одну задачу).
- `model-router.ts`: `ModelRouter` — `getConfig("main"|"vision")` (legacy-фолбэк), `call(role, messages)` через инжектируемый `ModelCaller`.
- `model-catalog.ts`: `PROVIDER_MODELS` — курируемый каталог по провайдерам; `getModelsForProvider(provider)`.

### `src/utils/security/` — безопасность

- `gateway-policy.ts`: `evaluateToolCall(toolName, trust)` → `{ allow, reason? }` — allowlist-политика (untrusted: без `bash`/`edit`/`write`).
- `secret-filter.ts`: `detectSecret(content)` — детерминированный фильтр секретов. `memory_add` отказывается хранить совпадения.

### `src/utils/briefing/` — брифинг и фокус

- `briefing.ts`: `buildBriefing(data)` — агрегация брифинга; `localDayKey`/`isSameLocalDay` — IANA timezone.
- `focus-time.ts`: `analyzeDay` (плотность, фрагментация, focus-блоки), `suggestAlternative`, `minutesToClock`.

### `src/utils/capabilities.ts` (верхний уровень)

`ExternalCapability` contract + `capabilityAvailable` / `describeLimitation` / `capabilitiesReport` (machine-readable: capabilities, degraded skills, approval-required actions). Пока все внешние capabilities отсутствуют.

### `src/context/ContextBuilder.ts`

Единая сборка контекста (skills не сканируют память сами): `getContactContext`,
`getMeetingContext`, `getDailyBriefingContext`, `getFinancialContext`,
`getCommitmentContext`. Инжектируемые reader-функции; без бизнес-логики skill.

### `src/workflow/workflows.ts`

Лёгкий workflow-слой: `MEETING_WORKFLOW`, `FINANCE_WORKFLOW`, `getWorkflow`,
`nextStep`, `workflowCapabilities`. Шаг = skill + capability + описание.

### `src/providers/providers.ts`

Интерфейсы `CalendarProvider`/`EmailProvider`/`CRMProvider`/`TravelProvider`/
`AccountingProvider` + noop-реализации (возвращают `ok:false` + лимит, кроме
локального `email.draft`). Реальные API не подключены — fake success запрещён.

### `src/cron/deterministic-tasks.ts`

Детерминированные cron-задачи (`daily-briefing`, `anomaly-scan`,
`commitment-due-scan`): сервис-запросы без LLM; LLM только синтезирует после.

### `src/capabilities/subagent-capabilities.ts`

Allowlist capabilities для субагентов (untrusted): только `memory.search`,
`ocr.process`, `report.pdf`, `report.pptx`.

---

## Расширения (`.pi/extensions/`)

Каждый каталог — одно расширение. Точка входа — `index.ts` с `export default function (pi: ExtensionAPI)`.

### `core-agent/`

Файлы: `index.ts`.

- **События**:
  - `before_agent_start` — добавляет в system-prompt:
    1. список доступных skills (`discoverSkills()` + `formatSkillsForPrompt` из `@griha/skills`);
    2. политику делегирования (`DELEGATION_POLICY`: SIMPLE → сам; COMPLEX → `delegate_tasks` → `check_subagents` → итог → `get_shared_insights`);
    3. политику закрытого цикла обучения (предлагать создание skill'а).
- **Команды**: `/skills` — список skills.

### `first-run-setup/`

Файлы: `index.ts`.

- **События**:
  - `session_start` (reason `"startup"`): если конфига нет — мастер настройки; если есть — `applyConfig`.
- **Мастер**: выбор провайдера (7 шт.), ключ (или детект env-ключа через `ORIGINAL_ENV_KEYS`), модель (каталог или вручную), baseUrl для `custom`, опционально vision-модель. Есть и terminal-fallback на `readline/promises`, когда нет TUI.
- **Команды**: `/setup` (повторный мастер), `/model` (сменить модель/провайдера).
- `applyConfig` импортируется из `src/utils/provider-bootstrap.js` (общий с telegram-bot).

### `sqlite-rag-memory/`

Файлы: `index.ts`, `MemoryService.ts`, `UserProfileService.ts`, `ClientNotesService.ts`, `types.ts`.

#### `MemoryService.ts` — ядро памяти

`SqliteRagMemoryService(embeddingService?)` поверх `better-sqlite3` + FTS5.

Схема (см. `SCHEMA_SQL`):

- таблицы `facts`, `messages`, `insights`;
- внешние FTS5-таблицы `*_fts` + триггеры синхронизации;
- индексы по `project_id`, `category`, `updated_at` (и `session_id` для messages).

Методы:

- `init(dbPath)` — открывает БД, `journal_mode = WAL`, создаёт схему, `migrate()`.
- `migrate()` — добавляет колонку `embedding`, если её нет (БД до Phase 4).
- `addFact(...)` — вставляет факт; если есть `embeddingService`, считает и сохраняет вектор (`BLOB` из `Float32Array`).
- `search(query, options)` — гибрид: `ftsSearch` (BM25) + `vectorSearch` (косинус) + `reciprocalRankFusion` (k=60). Без `embeddingService` — только FTS.
- `addMessage`, `getSessionMessages`, `searchSessions` — кросс-сессионный поиск сообщений.
- `listRecentFacts`, `getEmbedding`, `reembedMissing` (пересчитать факты без вектора).
- `addInsight`, `searchInsights`, `listRecentInsights` — Shared Insights.
- `close()`.

Вспомогательные: `buildFtsQuery` (`"токен"*` через `AND`), `escapeLike`, `clampLimit` (1..50, default 10), `cosineSimilarity`, `reciprocalRankFusion`.

#### `UserProfileService.ts`

Таблица `user_profiles` (`user_id` PK, поля профиля, `preferences` как JSON). Методы: `init`, `close`, `getProfile`, `upsertProfile` (мерж с существующим, `ON CONFLICT DO UPDATE`), `setPreference`.

#### `ClientNotesService.ts`

Таблица `client_notes` + FTS. Методы: `addNote`, `listNotes(userId)`, `searchNotes(userId, query)` (FTS → LIKE fallback), `deleteNote`.

#### `types.ts`

Интерфейс `MemoryService` (контракт, по которому тестируется и подменяется).

#### `index.ts`

- `DB_PATH = ~/.grish-ai/memory.sqlite`.
- `getService()` — ленивый синглтон с `HashingEmbeddingService`.
- **События**: `session_start` → init; `session_shutdown` → close.
- **Инструменты**: `memory_add`, `memory_search`.
- **Команды**: `/memory-reembed`.

### `multi-agent/`

Файлы: `index.ts`, `BotRegistry.ts`, `SubAgentManager.ts`.

#### `BotRegistry.ts`

Файловый реестр ботов: каталог `.grish-ai/bots`, каждый бот — `<id>.json`. Методы: `create`, `get`, `list(projectId?)`, `delete`.

#### `SubAgentManager.ts`

Запуск субагентов в памяти:

- каждому заданию — `taskId` и **`subtreeSessionId`** (изолированное «поддерево» памяти);
- `AbortController` на задание (для stop/steer);
- `start()` запускает фоново, `runOne()` — start+wait, `delegate()` — последовательно все;
- `steer()`: `continue`/`redirect`/`stop` (stop → abort);
- состояние в `SubAgentState`, результаты в `SubAgentResult`;
- explicit insights пишутся в Shared Insights через `InsightsStore`.

#### `index.ts`

- `getRegistry()`/`getMemory()`/`getManager()` — ленивые синглтоны.
- `emulatedRunner` — заглушка субагента (возвращает текст с ролью и целью).
- **Инструменты**: `delegate_tasks`, `check_subagents`, `get_shared_insights`, `list_subagents`, `steer_subagent`.
- **Команды**: `/bots`, `/bots-create`, `/status`, `/insights`, `/delegate`, `/steer`, `/stop`.

### `cron/`

Файлы: `index.ts`, `CronService.ts`.

#### `CronService.ts`

`CronService(dbPath, runner?, changeDetector?)`:

- таблицы `cron_jobs` и `cron_runs`;
- `intervalMinutes(schedule)` — вытаскивает число из строки (по умолчанию 60); `isDue` — сравнение с `lastRunAt`;
- `createJob`, `listJobs`, `getJob`, `setEnabled`, `updateNotepad`, `runJobNow`, `tick` (все due), `listRuns`;
- `run(job)`: если `monitorMode` + `changeDetector` и ничего не изменилось → `skipped`; если `continuity` — подмешивает `lastResult` и `notepad` в промпт; вызывает `runner` (или fallback), пишет `cron_runs`.

#### `index.ts`

- `emulatedRunner` — заглушка.
- **События**: `session_start` → init + `setInterval(tick, 60_000)`; `session_shutdown` → clearInterval.
- **Инструменты**: `cron_create`, `cron_list`, `cron_enable`, `cron_disable`, `cron_run_now`, `cron_update_notepad`.
- **Команда**: `/cron` (`list|create|notepad|run`).

### `model-router/`

Файлы: `index.ts`.

- `emulatedVision` — заглушка vision (`[vision] ...`), оставлена для юнит-тестов.
- **События**: `before_agent_start` — добавляет руководство «когда фото/скрин — используй `analyze_image`».
- **Инструмент**: `analyze_image` (`imageUrl`/`imageBase64`/`fileId` + `task` ocr|describe|ocr_and_describe + `languageHint`). `fileId` (Telegram-фото) резолвится в base64 через Bot API (`src/utils/telegram/telegram-files.ts`), затем реальный вызов `createHttpVisionCaller` (`src/utils/vision/http-vision.ts`) к `models.vision`; ключ провайдера регистрируется через `pi.registerProvider` (`registerModelProvider`).
- **Команда**: `/models` — статус main + vision.

### `personal-learning/`

Файлы: `index.ts`.

- `OWNER_ID = "owner"`; `emulatedLlm` — заглушка (пустая выдача), оставлена для юнит-тестов; в проде — `getLlm()` → `createHttpLearningLlm` (`src/utils/learning/http-learning.ts`, OpenAI-совместимый `/chat/completions`, модель из конфига).
- **События**:
  - `session_start` → init профилей и заметок;
  - `before_agent_start` → `formatPersonalContext` в system-prompt;
  - `agent_settled` → `maybeAutoLearn` (собрать диалог из `ctx.sessionManager.getEntries()`, `extractLearning`, confirm в UI, `applyLearning`).
- **Инструменты**: `get_user_profile`, `update_user_profile`, `add_client_note`, `list_client_notes`, `extract_learning`, `propose_skill_improvement`, `list_skill_proposals`.
- **Команды**: `/profile`, `/notes`, `/learn`, `/skills-improve`, `/skills-proposals`, `/skills-approve <id>`, `/skills-reject <id>`.
- **Auto skill improvement** (`src/utils/learning/skill-improver.ts`): LLM-предложение правки `skills/core/SKILL.md` или нового skill (`autoCreated: true`) на основе заметок; review-gated — применяется только после `ctx.ui.confirm`, иначе остаётся `pending` в durable-очереди (`~/.grish-ai/skill-proposals/*.json`).

### `telegram-bot/`

Полный разбор — в [docs/TELEGRAM-BOT.md](TELEGRAM-BOT.md). Кратко:

- `index.ts` — точка входа: создаёт пул, команды `/telegram-setup`, `/telegram-status`, `/telegram-start`, `/telegram-stop`, авто-старт на `session_start`, очистка на `session_shutdown`. Реальный адаптер: `sendDocument(chatId, path)` → `bot.api.sendDocument(chatId, new InputFile(path))`.
- `TelegramBotController.ts` — владеет grammy `Bot` (через инжектируемую фабрику), start/stop long polling, преобразует grammy `ctx` → `TgUpdate`; sender доставляет текст + опционально документ.
- `TelegramBridge.ts` — чистая логика: whitelist, команды `/start` `/status` `/new` `/rules`, голос (заглушка), фото/документ/текст → агент; ответ `{ text, filePath? }`.
- `TelegramSessionPool.ts` — изолированный `AgentSession` на пользователя; на `agent_end` забирает `takeSessionFile` и возвращает `{ text, filePath? }`.

### `user-rules/`

Файлы: `index.ts`, `UserRulesService.ts`, `prefilter.ts`, `commands.ts`, `context.ts`.

- `UserRulesService.ts` — SQLite-хранилище правил (CRUD + in-memory cache); hard/soft по `kind`; скоупы `global`/`chat`; `ownerUserId`.
- `prefilter.ts` — Layer-1: `detectKind` (hard/soft), `isOnlyOwnerRule`, `shouldProcessMessage` (0 токенов, до агента).
- `context.ts` — per-session Telegram-контекст (`setSessionContext`/`getSessionContext`/`clearSessionContext`).
- `index.ts` — Layer-2: инъекция soft-правил + Telegram-контекста в `before_agent_start`; инструменты `rules_list`/`rules_add`/`rules_edit`/`rules_delete`/`rules_get`; команда `/rules`; экспортирует `telegramRulesHandler`.

### `gateway/`

Файлы: `index.ts`. Единая точка блокировки side-effect tool-calls:

- `pi.on("tool_call")` → `getSessionTrust(sessionId)` + `evaluateToolCall(toolName, trust)` → при запрете `{ block: true, reason }`.

### `report-generator/`

Файлы: `index.ts`, `templates/*.html` (sales-report, expense-report, meeting-minutes).

- **Инструменты**: `generate_report(reportType, data)` (PDF) и `generate_presentation(slides)` (PPTX).
- Валидация данных — `src/utils/reports/report-schemas.ts`; рендер — `src/utils/reports/report-renderer.ts`; путь файла регистрируется в `src/utils/telegram/session-files.ts` через `ctx.sessionManager.getSessionId()` (для Telegram-доставки).
- Вывод: `~/.grish-ai/reports/<uuid>.pdf|.pptx`.

### `approval-gate/`

Файлы: `index.ts`, `ApprovalService.ts`.

- `ApprovalService` — SQLite (`~/.grish-ai/approvals.sqlite`): политики (global/chat) + pending-запросы с TTL.
- **Инструменты**: `approval_required`, `approval_status`, `approval_grant`, `approval_deny`, `policy_get`, `policy_set`.
- **Команды**: `/approvals`, `/approve <id>`, `/deny <id>`.
- Классификация и пороги — `src/utils/finance/approval-policy.ts`; идентичность — из `user-rules/context.ts`.

### `commitment-tracking/`

Файлы: `index.ts`, `CommitmentService.ts`.

- `CommitmentService` — SQLite (`~/.grish-ai/commitments.sqlite`); статусы `open|due_soon|overdue|completed|cancelled`, due_soon/overdue выводятся из `dueDate` (`deriveStatus`, `refreshStatuses`).
- **Инструменты**: `commitment_add`, `commitment_list`, `commitment_update`, `commitment_complete`, `commitment_cancel`.

### `voice-intake/`

Файлы: `index.ts`.

- **Инструмент**: `transcribe_voice(filePath | fileId)` — обёртка над `@griha/stt` (`transcribeVoice` → faster-whisper) + `assessTranscriptConfidence` (переспрос при неоднозначности).
- Telegram `fileId` скачивается через `src/utils/telegram/telegram-files.ts` (`downloadTelegramFileToDisk`).

### `proactive-assistant/`

Файлы: `index.ts`, `CalendarService.ts`, `AnomalyService.ts`, `BriefingService.ts`.

- `CalendarService` — события (connector-ready, внутренний календарь).
- `AnomalyService` — аномалии (запись дедуплицируется по type+explanation).
- `BriefingService` — подавление дублей брифинга (unique `user_id + day_key`).
- **Инструменты**: `event_add/list/cancel`, `briefing_generate`, `anomaly_list/ack`, `meeting_prep`, `contact_briefing`.

### `finance/`

Файлы: `index.ts`, `FinanceService.ts`.

- `FinanceService` — SQLite (`~/.grish-ai/finance.sqlite`): расходы + счета; статусы счетов выводятся из dueDate; `paid` — через approval policy.
- **Инструменты**: `expense_add/list`, `transaction_categorize`, `invoice_add/list/set_status`, `finance_summary` (детерминированная агрегация + сравнение периодов).
- Anomaly-скан счетов (duplicate + overdue) пишет в `AnomalyService`.

### `crm/`

Файлы: `index.ts`, `ContactService.ts`.

- `ContactService` — SQLite (`~/.grish-ai/contacts.sqlite`): identity, tags, last interaction, provenance; Unicode-безопасный dedupe.
- **Инструменты**: `contact_upsert`, `contact_list`, `contact_touch`.

### `travel/`

Файлы: `index.ts`, `TravelService.ts`.

- `TravelService` — SQLite (`~/.grish-ai/travel.sqlite`): itinerary items (flight/hotel/transfer).
- **Инструменты**: `travel_item_add`, `travel_list` (по tripId или upcoming N дней), `travel_itinerary`. Бронирование НЕ реализовано.

### `connector/`

Файлы: `index.ts`.

- **Инструмент**: `capabilities_list` — machine-readable отчёт (capabilities, degraded skills, approval-required actions) из `src/utils/capabilities.ts`.

## `src/sandbox/` — изоляция выполнения

- `types.ts` — `SandboxProvider`, `SandboxRunOptions`, `SandboxResult`, `SandboxKind`.
- `index.ts` — `createSandboxProvider(backend, options?)`: `dev` → `LocalSandboxProvider` (локальный процесс), `runsc` → `RunscSandboxProvider` (gVisor).
- `local-sandbox.ts` / `runsc-sandbox.ts` — реализации провайдеров.
- `gateway-context.ts` — `getSessionTrust(sessionId)` (trusted/untrusted по sessionId) + `TrustLevel`.
- `process.ts` — низкоуровневый запуск процесса.

---

## `packages/skills/skills/core/SKILL.md`

Канонический каталог skills (`@griha/skills`). Базовый skill `core` с frontmatter (`name: core`, `description`, `tags`) и политикой памяти: использовать `memory_add` для durable-фактов, `memory_search` перед использованием неуверенного контекста, не хранить секреты. Плюс правило закрытого цикла обучения. Дополнительные skills: `sales-report` и `meeting-minutes` (формат отчёта фиксирован шаблоном — агент вызывает `generate_report`, меняя только данные).

---

## `tests/`

- `tests/setup.ts` — `before()` только создаёт `tests/.tmp-db` (без `rm` — см. «мелочи» в ARCHITECTURE). Хелперы `getTestDbPath(name)`, `cleanTestDb(name)`.
- `tests/unit/*.test.ts` — `node:test` + `assert/strict`:
  - утилиты: `smoke`, `config`, `model-catalog`, `model-router`, `gateway-policy`, `sandbox`, `skill-improver`, `report-schemas`, `report-renderer`;
  - память: `memory-service`, `vector-memory`, `sqlite-vec`, `http-embeddings`;
  - multi-agent: `bot-registry`, `delegation`, `live-steering`, `real-subagent-runner`;
  - cron: `cron`, `cron-real`; обучение: `personal-learning`, `learning-schema`;
  - HTTP-вызовы: `http-vision`, `http-learning`, `telegram-files`;
  - telegram: `telegram` (bridge/controller/pool + доставка файла), `telegram-reset`;
  - `user-rules`.
- `tests/unit/*.integration.test.ts` — интеграционные (`real-subagent-runner`, `report-renderer`): реальный Chromium/субагент; скипаются без браузера/сети.
- `tests/integration/` — пусто (зарезервировано).

Запуск: `npm test` (это `tsx --test tests/**/*.test.ts`).
