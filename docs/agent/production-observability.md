# Production Observability — Architecture Map

Аудит существующего agent loop Griha. Только реальные пути (файл + функция/класс).
`NOT FOUND` = механизма реально нет.

> Итог: production-код НЕ изменён. Никаких новых таблиц/зависимостей/tracing.

---

## 1. Agent Entry Point

- **File:** `apps/agent/src/bot.ts`
- **Function/Class:** `main()` (headless entry)
- **Purpose:** Поднять `AgentSession` pi.dev с полным набором расширений без TUI; telegram-bot стартует long polling на `session_start`; `first-run-setup` применяет `~/.grish-ai/config.json`.
- **Inputs:** env (`GRISH_AI_HOME`, `GRIHA_OBS`, `GRIHA_AGENT_RUNTIME`, …).
- **Outputs:** headless agent session; telegram long polling.
- **Existing logging:** `emit({ component: "bot", event: "process.start" })`, `process.uncaught`/`process.unhandledRejection` (в `@griha/observability`).
- **Existing tests:** нет прямого unit-теста `bot.ts`.
- **Notes:** Также Telegram-вход: `apps/agent/.pi/extensions/telegram-bot/TelegramBotController.ts` (grammy long polling, `pollLoop`) → `TelegramBridge.handleUpdate()`.

## 2. Orchestrator / Agent Loop

- **File:** `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts`
- **Function/Class:** `TelegramSessionPool.runPrompt()` (line ~342) + `finish()` (terminal state)
- **Purpose:** Главный цикл Telegram-хода: claim-сессии → `preparePoolRouting` (маршрутизация) → budget apply → `session.prompt()` → `finish()` (turn.end / generation.finish / experience).
- **Inputs:** `sessionKey`, `session`, `chatId`, `userId`, `message`, `threadId`, `updateId`, `rulesContext`, `hasImage`, `hasVoice`, `chatType`.
- **Outputs:** `TelegramReply { text, filePath, documentCaption, inlineButtons }`.
- **Existing logging:** `logTelegramEvent` (`session.prompt.started/completed/failed/timeout`, `tool.execution.completed`, `routing.decision`), `emitTurnStart/emitTurnEnd`, `emitGenerationBudget/emitGenerationFinish`.
- **Existing tests:** `tests/unit/telegram.test.ts`, `telegram-prompt-timeout.test.ts`, `telegram-reset-lifecycle.test.ts`, `telegram-diagnostics.test.ts`, `telegram-execution-trace.test.ts`, `policy-per-chat-contract.test.ts`.
- **Notes:** Сам LLM-цикл (turn_start/turn_end/tool loop) живёт в платформе `@earendil-works/pi-agent-core` (`dist/agent-loop.js`) — Griha его не переписывает. Griha-рантайм-«ядро»: `apps/agent/src/runtime/kernel.ts` (`AgentKernelImpl` — registry движков, init/dispose). Маршрутизация моделей: `apps/agent/src/utils/routing/model-router.ts` (прод) + `apps/agent/src/runtime/model/select.ts` (детерминированный `selectModelRole`/`resolveModelConfig`).

## 3. Session Lifecycle

- **File:** `apps/agent/.pi/extensions/telegram-bot/session-key.ts` + `TelegramSessionPool.ts`
- **Function/Class:** `buildTelegramSessionKey()`, `sanitizeDirSegment()`, `TelegramSessionPool` (`createAgentSession` per key, `recycleSession`, `reset`)
- **Session ID format (exact):**
  - DM/Group: `tg:{userId}:{chatId}`
  - Topic: `tg:{userId}:{chatId}:t:{threadId}`
  - Пример: `tg:5700958253:-5239797479`, тема: `tg:5700958253:-5239797479:t:42`
  - `dm` fallback когда chatId отсутствует.
- **How chatId / threadId / userId are separated:** `userId` — первый сегмент; `chatId` — второй; `threadId` — суффикс `:t:{threadId}`. Они НЕ смешиваются — это уровни одного ключа (изоляция истории по чату/теме).
- **Existing logging:** `logTelegramError` (sessionId/chatId/userId/threadId поля), `clearSessionContext`/`setSessionContext` (`user-rules/context.ts`).
- **Existing tests:** `telegram-reset.test.ts`, `telegram-reset-lifecycle.test.ts`, `telegram.test.ts` (изоляция сессий).
- **Notes:** `sessionId` внутри pi.dev = session key (`tg:...`). Correlation ID хода — отдельный: `tg.{chatId}.{updateId}` (`buildTelegramCorrelationId`, `telegram-diagnostics.ts`). SessionManager хранится в `~/.grish-ai/bot/sessions` (`bot.ts`).

## 4. Context Builder

- **File:** `apps/agent/.pi/extensions/core-agent/index.ts`
- **Function/Class:** `pi.on("context")` → `pruneAgentToolResults`; `pi.on("before_agent_start")` → сборка `systemPrompt` секций.
- **What sources are used:** system-prompt-политики (DELEGATION_POLICY, ORCHESTRATION_POLICY, LANGUAGE_POLICY), skills (`discoverSkills` → `formatSkillsForPrompt`), profile-секция (`buildProfileSection`), router hint (`buildRouterHint`, `adaptive-router.ts`), personal context (`personal-learning/index.ts` → `formatPersonalContext`), user-rules инъекция (`user-rules`).
- **Truncation logic:** `apps/agent/.pi/extensions/core-agent/tool-result-prune.ts` (`pruneAgentToolResults`); рантайм `apps/agent/src/runtime/context/` (`prune.ts`, `compaction.ts` — `shouldCompress`/`compactContext`, `usage.ts` — `estimateTokens`/`usableBudget`).
- **Existing logging:** obs `context` событий нет напрямую; `runtimeObservability` фиксирует background review.
- **Existing tests:** `tests/unit/context-*` (compaction/prune), `tool-result-prune` тесты.
- **Notes:** Контекст для модели собирается платформой pi.dev; Griha добавляет секции через `before_agent_start`/`context`-события.

## 5. Memory / Retrieval

- **File:** `apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.ts`
- **Function/Class:** `MemoryService` (better-sqlite3 + `sqlite-vec` + FTS5)
- **Query construction:** `buildFtsQuery` (tokenize → `"token"*` AND), `escapeLike`, hybrid RRF (runtime `apps/agent/src/runtime/session/rrf.ts`).
- **Ranking / selection:** FTS5 + векторный (sqlite-vec) + RRF-гибрид; `runtime/memory/pipeline.ts` (`decidePersist`, `scanDecision`), `runtime/memory/store.ts` (`InMemoryMemoryStore`), `runtime/memory/types.ts` (`MemoryEngine`).
- **Existing logging:** нет специализированного retrieval-лога (gap).
- **Existing tests:** `tests/unit/` memory-* , `tools/memory-audit/*`.
- **Notes:** Таблицы `facts`/`messages`/`insights` (+`*_fts` virtual tables + embeddings). `messages.session_id` есть, но это память, не trace.

## 6. Tools

- **Registry file:** платформа pi.dev (`pi.registerTool`); Griha-инструменты регистрируются в расширениях (например `apps/agent/.pi/extensions/core-agent/index.ts` — `execute_code`, `personal-learning/index.ts` — `extract_learning`, `propose_skill_improvement`, …).
- **Execution file:** pi.dev agent-loop (`@earendil-works/pi-agent-core/dist/agent-loop.js`); `execute-code.ts` (`runExecuteCode`, runsc sandbox).
- **Result handling:** `tool-result-prune.ts` (`pruneAgentToolResults`); gateway `apps/agent/.pi/extensions/gateway/index.ts` (`evaluateToolCall` + `getSessionTrust`, block для untrusted).
- **Schema validation (yes/no + where):** **YES для входных параметров** — TypeBox (`Type.Object`) в `pi.registerTool` (`typebox` dependency). **Tool RESULT schema validation — NOT FOUND** (нет валидации результата тула; только `render-contracts` валидирует report-вывод через zod).
- **Retry logic (yes/no + where):** **Telegram API send retry — YES** (`apps/agent/.pi/extensions/telegram-bot/telegram-errors.ts`: `parseTelegramError`, `shouldRetrySend`, `computeSendDelayMs`; `send-queue.ts`: `ChatSendQueue`). **Generic tool retry вокруг LLM tool-call — NOT FOUND** (ретраи тулов не реализованы).
- **Existing logging:** `logTelegramEvent({ event: "tool.execution.completed", toolName, durationMs, status })` (в `TelegramSessionPool` подписке).
- **Existing tests:** `telegram.test.ts`, `wiring-delegation.test.ts`, gateway-тесты, `telegram-errors` тесты.
- **Notes:** Model fallback-цепочка есть в `model-router.ts` (429/5xx/timeout → следующий кандидат).

## 7. Error Handling

- **File:** `apps/agent/.pi/extensions/telegram-bot/telegram-diagnostics.ts`
- **Function/Class:** `logTelegramError()` (структурная diag), `formatTelegramError()`
- **How errors are currently classified:** только для Telegram-отправки в `telegram-errors.ts` (`retry_after` / `retryable` / `permanent`). **Единой taxonomy ошибок агента (primaryFailure / failureChain) — NOT FOUND.**
- **Existing logging:** `logTelegramError` (operation/stage/sessionId/chatId/userId/threadId/error/detail), `emit({ level: "error", ... })`.
- **Existing tests:** `telegram-diagnostics.test.ts`.
- **Notes:** Инвариант: `logTelegramError` никогда не бросает.

## 8. Final Response

- **File:** `apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts` (`finish()` → `resolveReply`) + `TelegramBotController.ts` (send via `ChatSendQueue`)
- **Function/Class:** `finish()`, `sendWithRetry`/`ChatSendQueue`, `formatTelegramHtml` (`TelegramBridge.ts`), `splitTelegramText` (4096-limit).
- **Existing logging:** `session.prompt.completed` (artifactId, durationMs), `turn.end`, `generation.finish`.
- **Existing tests:** `telegram.test.ts`, `telegram-diagnostics.test.ts`.
- **Notes:** Ответ идёт через очередь `ChatSendQueue` (per-chat хвост + retry).

## 9. Logging & Metrics (current state)

- **What is already logged:**
  - `@griha/observability` (`packages/observability/`): JSONL `~/.grish-ai/obs/events-YYYY-MM-DD.jsonl`; `emit()` → `ObsEvent` (`ts,level,component,event,correlationId,chatId,threadId,userId,sessionKey,durationMs,ok,code,data`); redact (`redact.ts` — TOKEN/BEARER/sensitive keys); `helpers.ts` (`emitTurnStart/End`, `emitGenerationBudget/Finish`); `query.ts` (`readObsEvents`, `summarizeObsEvents`); CLI `apps/obs-cli`.
  - Telegram diag: `logTelegramEvent` (console.log JSON), `logTelegramError` (console.error JSON), `emitUpdateOutcome` (outcome-трасса update) — `telegram-diagnostics.ts` / `TelegramBridge.ts`.
  - `runtimeObservability` (`apps/agent/src/utils/routing/runtime-observability.ts`) — in-process telemetry + `renderTelemetryDashboard` (`apps/agent/src/runtime/observability/dashboard.ts`).
- **What metrics already exist:**
  - `apps/agent/.pi/extensions/telegram-bot/metrics.ts` — `incMetric`/`getTelegramMetrics` (in-process счётчики: `telegram_updates_total`, `telegram_media_*`, `telegram_agent_invocations`, `telegram_ocr_failed`, `telegram_stt_failed`, …).
  - Obs `generation.budget`/`generation.finish` (токены/бюджет).
- **Gaps:** нет unified AgentTrace/span; нет ContextSource tracking; нет ToolTrace; нет structured error taxonomy; нет TaskOutcome/agentVersion; нет feedback-linkage; метрики — in-process без экспорта (кроме obs JSONL).

## 10. Database (relevant tables)

- **DB:** better-sqlite3 (`~/.grish-ai/memory.sqlite` — память; `documents.sqlite` — документы; `media-retry.sqlite`; `users.json` — ACL).
- **Table / collection** (файл — schema location):
  - `facts` / `facts_fts` / `messages` / `messages_fts` / `insights` / `insights_fts` — `apps/agent/.pi/extensions/sqlite-rag-memory/MemoryService.ts`
  - `client_notes` — `sqlite-rag-memory/ClientNotesService.ts`
  - `user_profiles` — `sqlite-rag-memory/UserProfileService.ts`
  - `expenses`, `invoices` — `finance/FinanceService.ts`
  - `contacts` — `crm/ContactService.ts`
  - `commitments` — `commitment-tracking/CommitmentService.ts`
  - `cron_jobs`, `cron_runs` — `cron/CronService.ts`
  - `calendar_events`, `anomalies`, `briefing_runs` — `proactive-assistant/*Service.ts`
  - `travel_items` — `travel/TravelService.ts`
  - `user_rules`, `chat_policy`, `chat_policy_history` — `user-rules/*`
  - `approval_policies`, `approval_requests` — `approval-gate/ApprovalService.ts`
  - `expense_documents`, `chat_archive`, `telegram_media`, `processed_updates` — `apps/agent/src/services/documents/DocumentsRepository.ts`
  - `media_retry_jobs` — `services/documents/media-retry.ts`
  - `group_reminders` — `services/reminders/GroupReminderService.ts`
  - `group_participants` — `services/secretary/participants.ts`
- **Key fields:** см. схемы выше (id TEXT PRIMARY KEY, session_id, role, content, timestamps, embeddings).
- **Notes:** **Нет отдельной таблицы agent-trace/span/outcome.** `messages.session_id` — для памяти, не trace. Migrations — инлайн `CREATE TABLE IF NOT EXISTS` в сервисах (нет отдельного migration-runner).

## 11. Tests (relevant)

- **Test file:** `apps/agent/tests/unit/*.test.ts` (node:test через `tsx`, ~1515 unit).
- **What it covers:** agent loop/pool (`telegram.test.ts`, `telegram-prompt-timeout.test.ts`, `telegram-reset*.test.ts`, `telegram-diagnostics.test.ts`, `telegram-execution-trace.test.ts`), tools/gateway (`gateway`, `wiring-delegation`), memory (`memory-*`, `tools/memory-audit/*`), reports (`render-contracts/schemas.test.ts`, `report-data/*`), learning (L0–L5 `learning-*`), skill versioning (`skill-versioning.test.ts`, `wiring-skill*.test.ts`).
- **Notes:** `apps/agent/package.json` test script: `GRIHA_OBS=0 tsx --test "tests/**/*.test.ts"`.

## 12. Versioning

- **Current agent/app version mechanism:** `apps/agent/package.json` → `"version": "0.0.0"` (placeholder). Корневой `package.json` без `version`.
- **File / env / package field:** `package.json#version` (0.0.0). **Git sha / env-var версия — NOT FOUND** (нет `GIT_SHA`/`agentVersion`/`appVersion` в коде).
- **Notes:** Для будущего `agentVersion` в trace нужен реальный источник (git sha при сборке или env), сейчас его нет.

## 13. Explicit gaps (NOT FOUND)

- **unified AgentTrace** — нет (есть correlation ID + obs JSONL + telegram diag, но нет единой trace-структуры с шагами).
- **ContextSource tracking** — нет (не фиксируется «почему этот контекст попал к модели»).
- **ToolTrace** — нет (есть только `tool.execution.completed` событие).
- **structured error taxonomy (primaryFailure / failureChain)** — нет.
- **TaskOutcome / agentVersion** — нет.
- **schema validation tool results** — нет (только вход через TypeBox; report через zod в `render-contracts`).
- **generic tool retry** — нет (только Telegram send retry).
- **user feedback (dislike/regenerate/correction)** — нет UI/механизма.
- **версия агента (git sha)** — нет.

---

## Особые проверки (явные ответы)

1. **Точный формат session ID Telegram:** `tg:{userId}:{chatId}` (DM/группа), `tg:{userId}:{chatId}:t:{threadId}` (тема форума). Реальные примеры из кода/тестов: `tg:5700958253:-5239797479`; тема `tg:{uid}:{chatId}:t:{threadId}`. Генератор — `buildTelegramSessionKey` (`session-key.ts`). Correlation ID хода — `tg.{chatId}.{updateId}` (`buildTelegramCorrelationId`).

2. **Trace / span / request-id механизм:** **Частично.** Есть `correlationId` (`tg.{chatId}.{updateId}`) и obs JSONL с `correlationId`/`sessionKey`; есть telegram diag JSON. Но **нет** единого AgentTrace со span/шагами.

3. **Schema validation tool results:** **Нет** для результатов тулов. Есть TypeBox для входных параметров (`pi.registerTool`), и zod в `packages/render-contracts/src/schemas.ts` (`RenderRequestSchema`) для report-вывода.

4. **Retry вокруг tools / model calls:** Model — fallback-цепочка в `model-router.ts` (YES). Tools — **NOT FOUND** generic retry. Telegram send — `telegram-errors.ts` (`shouldRetrySend`, `retry_after`/`retryable`) + `send-queue.ts`.

5. **Feedback от пользователя (dislike/regenerate/correction):** **NOT FOUND.** Есть только learning-маркеры в `runtime/learning/routing.ts` (классификация «предпочитает/не любит») и skill «corrections as learning signal» — но UI/механизма dislike/regenerate нет.

6. **Report generation со schema validation:** **YES частично.** `packages/render-contracts/src/schemas.ts` (zod `RenderRequestSchema`, `RenderBlockSchema`, `RenderTableSchema`, `RenderFormatSchema`, `RenderTemplateSchema`). Данные `ExpenseReport` — `packages/report-data/src/types.ts` (plain TS DTO, без zod).

7. **Версия (git sha / package.json / env):** `package.json#version = "0.0.0"` (placeholder). **Git sha / env-версия — NOT FOUND.**

---

## 14. Core AgentTrace (Prompt 02)

- **File:** `apps/agent/src/runtime/observability/trace.ts` (типы + `TraceManager`), `trace-store.ts` (`TraceStore`).
- **Where created/finished:** `TelegramSessionPool.runPrompt()` — `trace.start()` после correlationId; `trace.finish()` + `TraceStore.save()` в `finish()` (terminal state).
- **Trace ID:** `correlationId` (`tg.{chatId}.{updateId}`) — существующий request-id механизм.
- **sessionId:** существующий формат (`tg:{userId}:{chatId}` / `:t:{threadId}`), не меняется.
- **agentVersion:** `getAgentVersion()` → `GRIHA_AGENT_VERSION` env → `apps/agent/package.json#version` → `"unknown"`.
- **Persistence:** SQLite `~/.grish-ai/traces.sqlite`, таблица `agent_traces` (steps/final — JSON-колонки); retention 30 дней.
- **Redaction:** `metadata` каждого step прогоняется через `redactData` (`@griha/observability`).
- **Gated:** persist только при `isObsEnabled()` (`GRIHA_OBS !== "0"`).
- **Tests:** `tests/unit/observability-trace.test.ts`.

---

## Отчёт

1. **Найдено (реальные файлы/функции):**
   - `apps/agent/src/bot.ts` (`main`) — headless entry.
   - `TelegramBotController.ts` / `TelegramBridge.ts` (`handleUpdate`/`handleUpdateInner`) — Telegram вход.
   - `TelegramSessionPool.ts` (`runPrompt`/`finish`) — orchestrator хода.
   - `session-key.ts` (`buildTelegramSessionKey`) — session ID.
   - `telegram-diagnostics.ts` (`buildTelegramCorrelationId`, `logTelegramEvent`, `logTelegramError`) — correlation + diag.
   - `core-agent/index.ts` (`before_agent_start`, `context`, `turn_end`) — context builder.
   - `sqlite-rag-memory/MemoryService.ts` — memory/retrieval (FTS5 + vec + RRF).
   - `runtime/memory/*`, `runtime/context/*`, `runtime/model/select.ts`, `runtime/kernel.ts`.
   - `packages/observability/*` — JSONL obs (`emit`, `redactData`, `helpers`, `query`, `jsonl-sink`).
   - `telegram-bot/metrics.ts` (`incMetric`) — in-process метрики.
   - `telegram-errors.ts` (`parseTelegramError`, `shouldRetrySend`) — retry-классификация Telegram.
   - `packages/render-contracts/src/schemas.ts` (zod) — report schema validation.
   - `packages/report-data/src/types.ts` — ExpenseReport DTO.
   - SQLite таблицы: `facts/messages/insights` (+fts), `client_notes`, `user_profiles`, `expenses`, `cron_jobs/cron_runs`, `approval_*`, `expense_documents/chat_archive/telegram_media/processed_updates`, `media_retry_jobs`, `group_reminders`, `group_participants`, `user_rules/chat_policy`, `commitments`, `contacts`, `calendar_events/anomalies/briefing_runs`, `travel_items`.

2. **NOT FOUND:** unified AgentTrace; ContextSource tracking; ToolTrace; structured error taxonomy (primaryFailure/failureChain); TaskOutcome; agentVersion/git-sha; tool-result schema validation; generic tool retry; user feedback (dislike/regenerate/correction); отдельная trace/outcome таблица в SQLite.

3. **Session ID формат:** `tg:{userId}:{chatId}` и `tg:{userId}:{chatId}:t:{threadId}`; correlation `tg.{chatId}.{updateId}`.

4. **Logging/metrics:** obs JSONL (`@griha/observability`), telegram diag JSON (console), in-process counters (`metrics.ts`), `runtimeObservability` + dashboard.

5. **Validation tools/reports:** вход тулов — TypeBox; report — zod (`render-contracts`); tool result — нет.

6. **Version mechanism:** `package.json#version = "0.0.0"`; git sha/env — нет.

7. **Gaps для следующих промптов:** AgentTrace/TraceStep (02), ContextTrace/ContextSource (03), retrieval observability (04), ToolTrace + валидация результата (05), error taxonomy (06), retry/TaskOutcome/agentVersion (07), metrics/feedback/read-only Meta-hook/docs/acceptance (08).

8. **Griha source code changed: NO** (Prompt 01 — только аудит).

---

## 15. Metrics, Meta-hook, Acceptance (Prompt 08)

- **Metrics:** `runtime/observability/metrics.ts` — `computeMetrics(traces)` →
  `MetricsSummary`; `buildDiagnosticReport(traces)`; агрегация из `agent_traces`.
- **Read-only Meta-hook:** `toEvaluationRecord(trace)` → `AgentEvaluationRecord`;
  `TraceStore.get/list` — только чтение.
- **Feedback:** NOT FOUND (dislike/regenerate/correction нет).

### Acceptance checklist

- [x] Architecture Map существует
- [x] Каждый agent run имеет AgentTrace
- [x] trace содержит sessionId (существующий формат)
- [x] trace содержит agentVersion
- [x] tool calls отслеживаются
- [x] tool results + validation отслеживаются
- [x] retrieval отслеживается
- [x] context sources отслеживаются
- [x] ошибки классифицируются (AgentErrorCode + primaryFailure)
- [x] retry виден
- [x] TaskOutcome фиксируется
- [x] основные метрики доступны
- [x] секреты не попадают в trace
- [x] Telegram isolation сохранена
- [x] существующие тесты проходят
- [x] новые тесты проходят
- [x] документация создана
- [x] autonomous self-modification НЕ включена
- [x] production code cannot modify itself
