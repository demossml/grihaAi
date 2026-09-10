# Status — griha-ai

- [x] Group onboarding silent-until-configured: fixed — pending-группа молчит (R1–R8),
  настройка только в DM, safe_default не завершает онбординг (см. docs/TELEGRAM-BOT.md
  «Group setup contract», GROUP_ONBOARDING_FIX_REPORT.md)
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
- [x] `docs/archive/GRISHA_SKILLS.md` — полный каталог (статусы/инструменты/storage/connector/approval) + workflow graphs (Meeting/Finance/Executive lifecycle); живой каталог — `docs/SKILLS.md`
- [x] Tests: skill-catalog (наличие всех, без дублей, порядок, описания) — 208 tests

## Phase 21 — Final QA / Acceptance (этап 7)

- [x] Build gate: `npm install` + `typecheck` + `test` + `build` — зелёные (208 agent tests + 5 skills tests)
- [x] Static verification: нет секретов/`.env`/hardcoded keys, нет TODO вместо логики, нет duplicate services/registries
- [x] Safety scenarios S1–S10 проверены (draft/approval/commitment/due/briefing/anomaly/voice/connector/OCR/followup)
- [x] Data isolation: commitments/expenses/invoices/contacts/policies — scoped по userId (память в субсессиях — задокументированное ограничение)
- [x] Cron safety: dedupe брифингов, timezone, дедупликация аномалий, monitorMode
- [x] `docs/archive/GRISHA_SKILLS_FINAL_REPORT.md` + обновлены README/ARCHITECTURE/EXTENSIONS

## Phase 22 — Architecture Hardening (фазы 0–7)

- [x] Phase 0: `docs/archive/CURRENT_ARCHITECTURE.md` (аудит, mapping current→target layer)
- [x] Phase 1: Domain Foundations — Commitment contract (actor/action/target/deadline/sourceMessageId/completedAt, миграция БД), `src/types/domain.ts`
- [x] Phase 2: Policy/Approval/Capabilities — Capability Registry (4 статуса), Approval scope (ONCE/SESSION/WORKFLOW) + статусы approved/rejected/cancelled, UserRule `ruleClass`, learning guard
- [x] Phase 3–4: ContextBuilder, Workflow (meeting/finance), Provider-интерфейсы (noop), sub-agent capability allowlist
- [x] Phase 5–6: deterministic cron tasks (daily-briefing/anomaly-scan/commitment-due-scan), detectRepeatedFailures, ORCHESTRATION_POLICY в core-agent
- [x] Phase 7: `docs/archive/DOMAIN-ARCHITECTURE.md`, обновлены README/ARCHITECTURE/EXTENSIONS/SECURITY, `TEST_REPORT.md`
- [x] Tests: 240 agent + 5 skills — зелёные

## Phase 23 — Telegram-бот: стабильность (ТЗ починки бота)

- [x] Headless-запуск: `apps/agent/src/bot.ts` (AgentSession без TUI, long polling на session_start) + `deploy/griha-ai.service` (systemd без `script`)
- [x] `TelegramBotController`: `pollLoop` с автопереподключением (10с) + `sendWithRetry` (5 попыток, пауза 3с×попытка) + логи входящих/исходящих
- [x] Прокси: `proxy.ts` (`resolveProxyUrl`/`buildBotOptions`), grammy создаётся с `HttpsProxyAgent` при `HTTPS_PROXY`
- [x] Авторизация модели: логирование результата `applyConfig` (успех/причина неудачи) в основной сессии и Telegram-субсессиях
- [x] Tests: reconnect/retry (6), proxy (2), applyConfig (2) — 250 tests

## Phase 24 — PDF-рендер на @json-render/react-pdf

- [x] PDF-рендер отчётов мигрировал с Playwright (headless Chromium) на **@json-render/react-pdf** (JSON-spec + `@react-pdf/renderer`, чистый Node без браузера)
- [x] `src/utils/reports/report-specs.ts` — три builder-функции (sales/expense/meeting-minutes) из фиксированного каталога компонентов; Handlebars-шаблоны удалены
- [x] `renderPdfReport` с DI (`pdfSpecRenderFn`); unit-тесты проверяют spec-дерево, integration-тест рендерит реальный PDF в обычном CI
- [x] Презентации (pptxgenjs) — без изменений

## Phase 25 — Telegram Hardening P0+P1 (D1–D10)

- [x] D1: mentions — `entities` + `caption_entities` → `botMentioned`/`startsWithOtherMention` в pre-filter
- [x] D2: сквозные session keys `tg:{uid}:{chat}[:t:{threadId}]` (bridge/pool/директории/`/new`), sanitize против traversal
- [x] D3: голосовые в DM — STT через `@griha/stt` (stt-unavailable/stt-failed/stt-empty, temp-файл удаляется)
- [x] D4: ACL callback-запросов — единый `UsersService.aclCheck` (fallback legacy whitelist)
- [x] D5: `/setup` — только в DM; `/setup <chatId>` → один keyboard, пусто → до 5 keyboard'ов
- [x] D6: `getMe` с try/catch-логом на каждом bot instance; D7: plain-text фолбэк чанка при сбое HTML
- [x] D8: `ChatSetupService.reload()`; D9: `/start`-хинт про pending-группы
- [x] Не сломаны: silent-until-configured (R1–R8), forum `message_thread_id`, изоляция сессий
- [x] Tests: 420 unit — зелёные; typecheck/build зелёные; отчёт `TELEGRAM_HARDENING_REPORT.md`

## Phase 26 — Telegram Reliability + Group Admin Auth (Пакеты A+B)

- [x] `telegram-errors.ts`: классификация ошибок (429/retry_after, retryable 5xx/сеть, 403/401/400, unknown) + `computeSendDelayMs` (retry_after → N секунд, retryable → экспонента+jitter) + `shouldRetrySend`
- [x] `sendWithRetry` переписан: парсит ошибку, логирует retry_after, ретраит только retry_after/retryable; plain-фолбэк (D7) идёт через тот же retry (400 → сразу plain, без шторма)
- [x] `send-queue.ts` — per-chat очередь исходящих sendMessage/sendDocument (разные чаты не блокируются)
- [x] `chat-auth.ts` — `assertCanConfigureGroup`: пресет/keyboard для группы — только creator/administrator через getChatMember (fail closed: 400/403 → «нет прав», сеть → «попробуйте позже»)
- [x] Wiring: real grammy `getChatMember` → setup-callbacks и `/setup <chatId>`; global owner без админства группы пресет применить не может
- [x] Не откачено: silent-until-configured, caption_entities, session keys, STT, ACL callbacks, forum threads
- [x] Tests: 450 unit — зелёные; отчёт `TELEGRAM_RELIABILITY_AUTH_REPORT.md`

## Phase 27 — Telegram Groups Rewrite (онбординг в группе)

- [x] P0: `toChatMemberEvent` читает grammy-getter `ctx.myChatMember` (camelCase) / `ctx.update.my_chat_member` — раньше плоское snake_case поле отсутствовало и онбординг не запускался никогда (FR-1)
- [x] Риск A: онбординг-сообщение с кнопками пресетов уходит **в саму группу** (бот в группе не ограничен «первым /start») + DM добавившему (FR-2, FR-3)
- [x] Ограничение D (согласовано с заказчиком): тишина только по контенту — онбординг и `/setup` в pending-группе разрешены; LLM-ответы по-прежнему блокируются (FR-5)
- [x] `/setup` в группе: только для этой группы; право настройки — creator/administrator группы ИЛИ owner/admin ACL бота (FR-4); в DM — как раньше
- [x] FR-6: сервисные сообщения (new_chat_members/left_chat_member и т.п.) отсекаются до агента с отдельным логом
- [x] FR-8: повторный add при pending не дублирует онбординг; FR-9: логирование my_chat_member (событие/chat/actor/результат)
- [x] Риск B уже закрыт Пакетом B (getChatMember, fail closed); Риск C — callback_data ≤64 байт (уже учтено)
- [x] Tests: 458 unit — зелёные; docs/TELEGRAM-BOT.md обновлён; отчёт `TELEGRAM_GROUPS_REWRITE_REPORT.md`

## Phase 28 — send_file: отправка файлов в Telegram

- [x] Инструмент `send_file(filePath, caption?)` в Telegram-субсессиях (`telegram-file-send`, в `SUB_SESSION_EXTENSIONS`)
- [x] chatId/threadId из контекста сессии (pool ставит перед prompt); форум — ответ в ту же тему
- [x] Отправка через мост в контроллер: текущий bot instance + per-chat очередь + sendWithRetry (retry_after/429) + grammy InputFile
- [x] Валидация (`file-send.ts`): существует/обычный файл/≤50 МБ/внутри разрешённых корней (tmp/cwd/~/.grish-ai)
- [x] ACL — UsersService.isAllowed (как у входящих апдейтов); логирование кто/что/куда + file_id/message_id
- [x] Не сломан report-generator (session-files.ts — отдельный путь); документы в форуме теперь тоже с message_thread_id
- [x] Tests: 470 unit — зелёные; typecheck/build зелёные

## Phase 29 — Слушатель-архивариус (listen_only)

- [x] `listen_only` = «обрабатывать, но не отвечать»: все тексты/фото/документы группы обрабатываются, ответ подавляется без явного @mention (reply — не обращение)
- [x] `evaluatePreFilter` → `{process, suppressReply, archive}`; `shouldProcessMessage` — совместимая обёртка; игнор ботов/сервисных сохранён, require_mention не блокирует обработку в режиме архива
- [x] Таблица `chat_archive` в `documents.sqlite` (`ChatArchiveService`): текст (дедуп по chat+message_id), медиа (скачать → extract/OCR → дедуп по file_unique_id, сырой OCR + флаги); чеки дополнительно в `expense_documents` (одно скачивание)
- [x] Bridge: архив тихий (без ack), ошибки архива не роняют обработку; индикатор «печатает…» сразу после приёма для всех обрабатываемых сообщений
- [x] Прочие пресеты (team/secretary/shop/only_me/safe_default) не затронуты; pending-silent (R1) сохранён
- [x] Tests: 483 unit — зелёные; отчёт `ARCHIVIST_MODE_REPORT.md`

## Phase 30 — Group Runtime Contract (R-GR-1…R-GR-12)

- [x] R-GR-1/2: pending-группа — ноль ответов (даже на @mention); онбординг-кнопки только в DM, fallback в группу — одна короткая строка без кнопок; `/setup` — только в DM
- [x] R-GR-3/4: `group-runtime.ts` (`prepareGroupTurn` + `processInboundMessage`) — каждый ход: ACL → configured → правила чата → hard-prefilter в коде → STT/медиа → агент; `formatRulesContext` → `[GROUP_RULES]`-префикс в prompt на каждый ход (пул)
- [x] R-GR-5/6: изоляция через sessionKey (без субагентов на группу); R-GR-9: ответ в тот же чат/тему
- [x] R-GR-7: `media-retry.sqlite` + `MediaRetryQueue` + фоновый воркер (60с, backoff 30·2^n ≤ 3600с, dead-letter); хуки в archiveHandler/documentIngest — file_id не теряется
- [x] R-GR-8: `notify_poor_ocr` (default off, порог 0.4) — уведомление о плохом OCR только по флагу
- [x] R-GR-10: caption_entities, STT, 429/retry_after, getChatMember — без регрессий; R-GR-11: typecheck+тесты зелёные; R-GR-12: docs (TELEGRAM-BOT.md «Group Runtime Contract»)
- [x] Contract-текст добавлен в `packages/skills/skills/core/SKILL.md`
- [x] Tests: 499 unit — зелёные; отчёт `GROUP_RUNTIME_CONTRACT_REPORT.md`

## Phase 31 — Typing heartbeat

- [x] `typing-heartbeat.ts`: пульс `sendChatAction(typing)` каждые ~4с (Telegram гасит через ~5с), immediate first pulse, ошибки глотаются
- [x] Bridge: heartbeat только после allow (не silent/pending/ACL/prefilter); в archivist silent-archive — без heartbeat; finally — остановка при любой ошибке; форум — тот же message_thread_id
- [x] Ветки обёрнуты: text, voice (на время STT и агента), photo/document, contact/location; wiring через controller → grammy (message_thread_id)
- [x] Tests: 507 unit — зелёные; typecheck/build зелёные

## Phase 32 — Listen-Only Archive → OCR → Structured Ingest

- [x] L1: listen_only — агент НЕ вызывается для ordinary messages; ответ разрешён только на @mention/reply боту (prefilter)
- [x] L2/L3/L4: медиа в listener обрабатывается фоном (без LLM): download → OCR → chat_archive → expense_documents при полях и `archive_ocr_ingest` (require_mention не блокирует фон)
- [x] `ListenerMediaPipeline` (одно скачивание, дедуп file_unique_id, L8 — только поля extractor, L9 — thread_id); additive-колонки архива `ocr_status`/`expense_id`
- [x] L6: media-retry worker выполняет ПОЛНЫЙ конвейер (processMediaRetryJob), не только сырой archive
- [x] Пресет listener: +archive_media/archive_ocr_ingest, reply_to_bot=true, notify_poor_ocr=false; миграция существующих listener-чатов в bootstrapUsers (идемпотентно)
- [x] L5: pending-группа — по-прежнему полная тишина; L7/L10/L11: needsReview+notify только по флагу, typecheck+тесты зелёные, docs обновлены
- [x] Tests: 512 unit — зелёные; отчёт `LISTEN_ONLY_OCR_REPORT.md`

## Phase 33 — Vision OCR для фонового инжеста групп

- [x] `VisionExtractor` + `VisionOcrFn` в extractors/types.ts: файл → vision-backend → парсеры суммы/даты/поставщика → `detectKind` (receipt/invoice/waybill), честные confidence/needsReview
- [x] Фабрика `createExtractor(config, hasVisionKey, visionOcr?)`: vision при ключе И собранном ocr; без ключа — StubExtractor (offline/тесты)
- [x] `documents/index.ts`: `buildVisionOcr` из `createHttpVisionCaller` (тот же backend, что analyze_image) прокинут в DocumentIngestService / ChatArchiveService / ListenerMediaPipeline — группы и личный чат распознают ОДИНАКОВО
- [x] Без `models.vision.apiKey` — поведение прежнее (stub), без падений
- [x] Tests: 521 unit — зелёные; typecheck/build зелёные





## Phase 34 — Group Photo Vision OCR (OCR до агента)

- [x] `TelegramBridge.handleMedia` — единая ветка photo/document: pending — тишина,
  иначе download → OCR → archive/expense → агент с блоком «Распознанный текст
  (OCR)» и `expenseId`; `telegram_file_id` — справочно внизу (не голый file_id)
- [x] `processMedia`-хук в bridge/controller: контроллер решает по правилам чата
  (listen_only / archive_ocr_ingest / archive_media / ingest_mode), иначе skipped
- [x] `maybeIngestDocument({force, skipAck})`: mention не блокирует force-путь
  listener'а; ACL всегда
- [x] PDF/non-image — честный needsReview (не притворяется JPEG); VisionExtractor
  ловит сбой OCR сам (needsReview, без исключения); confidence 0.85/0.55/0.1
- [x] Expense-инжест по useful fields (total/supplier/rawText>20), не только
  kind=receipt/invoice
- [x] Typing-heartbeat через OCR+агент; media-retry — полный pipeline
- [x] Tests: 536 unit — зелёные; typecheck/build зелёные; отчёт
  `GROUP_PHOTO_VISION_REPORT.md`
