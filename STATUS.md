# Status — griha-ai

- [x] Scaffold + modern types (BotConfig, layered memory)
- [x] Test harness green
- [x] Hybrid FTS5 memory (facts + session search + listRecentFacts)
- [x] `memory_add` / `memory_search` tools via pi extension
- [x] Skills discovery + `autoCreated` + prompt formatting (позже перенесено в `@griha/skills`)
- [x] `skills/core/SKILL.md` (manager/secretary/accountant + memory policy)
- [x] `core-agent` extension (skills injection + closed loop + `/skills`)
- [x] README + .gitignore
- [x] File-backed Bot registry (Bot Mode spirit)
- [x] `multi-agent` extension (`/bots`, `/bots-create`)

## Phase 0.5 / 1b — First-run interactive setup

- [x] First-run interactive setup wizard
- [x] Config saved to ~/.grish-ai/config.json
- [x] /setup and /model commands
- [x] On first launch user chooses provider + model and can talk immediately

## Phase 1c — Provider + specific model selection

- [x] First-run wizard lets user choose provider AND concrete model from a list
- [x] DeepSeek is present with deepseek-v4-pro and deepseek-v4-flash-vision-exp
- [x] /model command allows changing model later
- [x] Custom model name is always possible

## Phase 4 — Vector Memory
- [x] EmbeddingService: реальный HTTP-backend (`createEmbeddingService`, OpenAI-совместимый `/embeddings` из `cfg.embedding`) + `HashingEmbeddingService` как offline-fallback; векторный поиск через sqlite-vec (`vec_distance_cosine`) с fallback на JS-косинус
- [x] Vectors stored for every new fact
- [x] Hybrid search (vector + FTS5 + RRF)
- [x] memory_search now understands meaning
- [x] Tests green (including semantic retrieval test)
- [x] DeepSeek and other providers still work

## Phase 5 — Smart Delegation
- [x] Adaptive routing (SIMPLE / COMPLEX)
- [x] Автоматическое разбиение задачи
- [x] Запуск нескольких субагентов
- [x] Изолированная память субагентов (subtreeSessionId)
- [x] Shared Insights layer
- [x] Tools: delegate_tasks, check_subagents, get_shared_insights
- [x] Tests green

## Phase 6 — Live Steering
- [x] SubAgentState + live tracking
- [x] list_subagents / steer_subagent tools
- [x] /status, /steer, /stop commands
- [x] Возможность остановить с сохранением partial result
- [x] Tests green

## Phase 7 — Cron with Memory
- [x] CronJob + continuity + monitorMode + notepad
- [x] Durable storage in sqlite
- [x] Tools + CLI
- [x] Background tick
- [x] Tests green

## Phase 8 — Telegram Bot
- [x] TypeScript only (grammy)
- [x] Long polling (без webhook)
- [x] Белый список пользователей
- [x] Двусторонняя связь с Гришей (реальный агент, не эхо-заглушка)
- [x] Изолированные сессии на пользователя (`TelegramSessionPool`, отдельный `AgentSession`/sessionId на `tg:<userId>`)
- [x] Поддержка текста и фото
- [x] /telegram-setup и статус
- [x] Tests green

## Phase 9 — Personal Learning
- [x] UserProfile layer
- [x] Client Notes (procedural)
- [x] Auto-extraction of facts/preferences/notes
- [x] Подмешивание профиля и заметок в контекст
- [x] /profile, /notes, /learn
- [x] Tests green
- [x] Auto skill improvement (review-gated: LLM-предложение → `ctx.ui.confirm`/очередь → apply в skills)

## Phase 10 — Multi-Model Routing
- [x] Конфиг models.main + models.vision
- [x] ModelRouter
- [x] Tool analyze_image (OCR / describe)
- [x] Интеграция с Telegram (фото уходит к Main Brain)
- [x] /model и /setup умеют настраивать vision
- [x] Flash отсутствует (осознанно)
- [x] Tests green

## Phase 11 — User Rules
- [x] SQLite-хранилище user_rules (CRUD + in-memory cache)
- [x] Инструменты rules_list / rules_add / rules_edit / rules_delete / rules_get
- [x] Pre-filter hard-правил до агента (0 токенов, «только мои сообщения»)
- [x] Injection soft-правил в system-prompt (global + chat)
- [x] /rules команда (list / add / delete / on / off) + Telegram /rules с chat-контекстом
- [x] Tests green

## Phase 12 — Monorepo (Turborepo + Hono)
- [x] npm workspaces: apps/* + packages/*
- [x] turbo.json (build/typecheck/test) + root scripts
- [x] packages/tsconfig (@griha/tsconfig: base.json, node.json)
- [x] packages/shared-types (@griha/shared-types: config types, UserRule, STT)
- [x] packages/config (@griha/config: ~/.grish-ai helpers)
- [x] packages/stt (@griha/stt: transcribeVoice → python3 bridge; backend — faster-whisper офлайн)
- [x] apps/agent — все .pi/extensions + src + skills + tests перенесены
- [x] apps/api — /health + /transcribe (STT-прокси) + /admin (status/telegram-sessions, auth через adminApiKey)
- [x] apps/skills — stub package
- [x] Импорты через @griha/* (без ../../../packages/...)
- [x] turbo run typecheck и turbo run test зелёные (72 tests)

## Phase 13 — Skills package (@griha/skills)
- [x] Контент перенесён в packages/skills/skills/ (core/SKILL.md)
- [x] Registry API: getSkillsRoot, discoverSkills(rootDir?), formatSkillsForPrompt, SkillMeta
- [x] Минимальный frontmatter-парсер (без зависимости от pi)
- [x] core-agent импортирует из @griha/skills (discoverSkills() без cwd)
- [x] Старый apps/agent/src/utils/skills.ts удалён; apps/agent/skills → README «moved»
- [x] apps/skills stub удалён (канон хранения = packages/skills)
- [x] Tests: @griha/skills 5 tests + agent 69 tests — зелёные
- [x] typecheck зелёный (10 задач)

**Initial Working Project reached — ready for further phases (hard isolation, gateway).**

## Phase 14 — Hard isolation & gateway

- [x] `docs/SECURITY.md` — периметр, модель доверия, слои защиты
- [x] Gateway-расширение (`gateway`) — единая точка блокировки `tool_call` по allowlist
- [x] `src/utils/gateway-policy.ts` — чистая политика (trusted/untrusted)
- [x] `src/sandbox` — `SandboxProvider` (DI): `dev` (local) + `runsc` (gVisor)
- [x] Субагенты/cron помечаются `untrusted` → без shell и мутации файлов
- [x] Tests: gateway-policy + sandbox (dev/runsc-missing)

## Phase 15 — Report generator (PDF/PPTX по фиксированным шаблонам)

- [x] Расширение `report-generator` (generate_report / generate_presentation)
- [x] Handlebars-шаблоны: sales-report, expense-report, meeting-minutes
- [x] TypeBox-схемы (`src/utils/report-schemas.ts`) — валидация до рендера
- [x] `src/utils/report-renderer.ts` — renderHtml / renderPdfReport (Playwright) / renderPresentation (pptxgenjs)
- [x] DI: pdfRenderFn/pptxWriteFn инжектируемы; integration-тест с реальным Chromium — skip без браузера

## Phase 15b — Telegram-доставка сгенерированных файлов

- [x] `src/utils/session-files.ts` — per-session registry `setSessionFile`/`takeSessionFile`
- [x] `generate_report`/`generate_presentation` регистрируют путь через `ctx.sessionManager.getSessionId()`
- [x] `TelegramSessionPool.runPrompt` забирает файл на `agent_end` и возвращает `{text, filePath?}`
- [x] Bridge/controller: текст доставляется как раньше, при наличии файла — `sendDocument` (grammy `InputFile`)
- [x] `report-generator` добавлен в `SUB_SESSION_EXTENSIONS` Telegram-сессий
- [x] Skills: `sales-report` и `meeting-minutes` (формат фиксирован шаблоном, агент меняет только данные)
- [x] Tests: доставка файла в bridge/controller/pool (grammy Bot замокан)

## Phase 16 — Foundation: safety + state (этап 2)

- [x] `approval-gate` extension: `ApprovalService` (SQLite `~/.grish-ai/approvals.sqlite`) + tools `approval_required`/`approval_status`/`approval_grant`/`approval_deny` + `policy_get`/`policy_set`; команды `/approvals`, `/approve <id>`, `/deny <id>`
- [x] Классификация действий (`src/utils/approval-policy.ts`): `READ_ONLY | REVERSIBLE_LOW_RISK | SIDE_EFFECT | HIGH_RISK_IRREVERSIBLE`; сегментный матчинг токенов
- [x] Финансовые пороги (`approval-thresholds`): `FinancialApprovalPolicy` (autoApproveBelow/alwaysConfirmAbove/categoriesAlwaysConfirm) — политика приоритетнее LLM
- [x] `commitment-tracking` extension: `CommitmentService` + tools `commitment_add/list/update/complete/cancel`; статусы `open|due_soon|overdue|completed|cancelled` (due_soon/overdue выводятся из dueDate)
- [x] `voice-intake` extension: tool `transcribe_voice` (filePath/fileId) + `assessTranscriptConfidence` (эвристический gate, переспрос при неоднозначности)
- [x] `privacy-data-hygiene`: `src/utils/secret-filter.ts` — `memory_add` отказывается хранить секреты (API keys/password/token/bot token/карты/private key)
- [x] `delegation-triage`: уточнён `adaptive-router` — не делегировать короткие reminders/CRUD/классификации
- [x] Новые extensions добавлены в `SUB_SESSION_EXTENSIONS` Telegram-сессий (approval-gate, commitment-tracking, voice-intake)
- [x] Skills: `human-approval-gate`, `approval-thresholds`, `commitment-tracking`, `voice-intake`, `privacy-data-hygiene`, `delegation-triage`
- [x] Tests: approval boundaries/thresholds, approval service, commitment extraction/status/refresh, secret filter, voice confidence, delegation triage (168 tests)

## Phase 17 — Proactive executive assistant (этап 3)

- [x] `proactive-assistant` extension: `CalendarService` (события, connector-ready), `AnomalyService`, `BriefingService` (подавление дублей по user+день)
- [x] Tools: `event_add/list/cancel`, `briefing_generate`, `anomaly_list/ack`, `meeting_prep`, `contact_briefing`
- [x] `src/utils/briefing.ts` — чистая агрегация брифинга (timezone, пустые секции опускаются, overdue/today/followup/approvals/anomalies/клиенты)
- [x] `src/utils/anomaly-detect.ts` — детекторы: commitment overdue, duplicate invoices, expense spikes (baseline × threshold + explanation)
- [x] `src/utils/focus-time.ts` — плотность дня, фрагментация, focus-блоки, предложение альтернативного слота
- [x] `proactive-assistant` добавлен в `SUB_SESSION_EXTENSIONS` Telegram-сессий
- [x] Skills: `daily-briefing`, `anomaly-watch`, `meeting-prep`, `meeting-followup`, `contact-context-briefing`, `calendar-scheduling`, `focus-time-protection`, `meeting-notes`
- [x] Tests: briefing timezone/empty sections/commitments, focus-time, anomaly detectors, calendar service (184 tests)

## Phase 18 — Finance + Documents + CRM (этап 4)

- [x] `finance` extension: `FinanceService` (expenses + invoices) + tools `expense_add/list`, `transaction_categorize`, `invoice_add/list/set_status`, `finance_summary`
- [x] Статусы invoice (`draft|sent|due|overdue|paid|cancelled`) выводятся из dueDate; `paid` — финансовое действие, проходит approval policy
- [x] `src/utils/finance.ts` — категоризация (история → уточнение, без auto-apply на похожие), `summarizeExpenses`/`comparePeriods`, `parseExpenseFromOcr` (не угадывает)
- [x] `crm` extension: `ContactService` (identity, tags, last interaction, provenance, Unicode-безопасный dedupe) + tools `contact_upsert/list/touch`
- [x] Anomaly-скан счетов: duplicate invoices + invoice overdue записываются в AnomalyService
- [x] Skills: `expense-invoice-tracking`, `transaction-categorization`, `invoice-followup`, `financial-report`, `document-intake-ocr`, `document-drafting`, `client-notes-crm`
- [x] `finance` и `crm` добавлены в `SUB_SESSION_EXTENSIONS` Telegram-сессий
- [x] Tests: finance utils, finance service (invoice statuses), contact service (199 tests)

## Phase 19 — Connector-ready architecture (этап 5)

- [x] `ExternalCapability` union + `src/utils/capabilities.ts` (capability report, degraded skills, approval-required actions) — machine-readable
- [x] `connector` extension: tool `capabilities_list`
- [x] `travel` extension: `TravelService` + tools `travel_item_add/list/upcoming/itinerary`; booking НЕ реализован (connector-ready)
- [x] Skills: `correspondence`, `inbox-triage`, `travel-coordination` (draft fallback, честное ограничение, approval перед отправкой)
- [x] `travel` и `connector` добавлены в `SUB_SESSION_EXTENSIONS`
- [x] Tests: capabilities report, travel service (204 tests)

## Phase 20 — Canonical skill catalog + workflows (этап 6)

- [x] Все 25 canonical skills + `core` существуют в `packages/skills` и видны registry
- [x] `discoverSkills` возвращает детерминированный порядок (sort по name)
- [x] `docs/GRISHA_SKILLS.md` — полный каталог (статусы/инструменты/storage/connector/approval) + workflow graphs (Meeting/Finance/Executive lifecycle)
- [x] Tests: skill-catalog (наличие всех, без дублей, порядок, описания) — 208 tests



