# Agent Tracing

Единая trace-структура одного agent-run (Prompt 02). Полная карта observability —
[production-observability.md](production-observability.md); агрегация метрик —
[metrics.md](metrics.md); основа Meta-Harness — [meta-harness-foundation.md](meta-harness-foundation.md).

## Как создаётся

Один `AgentTrace` на один Telegram-ход, встраивается **только** в orchestrator:

```
TelegramSessionPool.runPrompt()
  → correlationId = tg.{chatId}.{updateId}
  → trace.start({ traceId: correlationId, sessionId, agentVersion, ... })
  → trace.addStep("input")
  → trace.addStep("model")  (перед session.prompt)
  → trace.addStep("tool_call"/"tool_result")  (на tool_execution_end)
  → finish() (terminal state):
      trace.addStep("final")
      trace.finish(status, final)
      if (isObsEnabled()) TraceStore.save(trace)
```

## Где хранится

- SQLite: `~/.grish-ai/traces.sqlite` (отдельная БД, не `memory.sqlite`).
- Таблица `agent_traces` (trace_id PK, session_id indexed, agent_version, status,
  started_at/finished_at, user_id/chat_id/thread_id/task_type, steps_json, final_json).
- `steps` и `final` — JSON-колонки (шаги append-only и ограничены; анализ на
  уровне trace, join не нужен).
- **Retention:** 30 дней (`DELETE ... WHERE started_at < cutoff` при каждом save).
- Persist только при `GRIHA_OBS !== "0"` (off = поведение 1:1, нет новых записей).

## Что нельзя класть в trace

- API keys, tokens, passwords, Authorization headers, любые credentials.
- Полные промпты с секретами.
- Содержимое tool args/results (только имя тула + тайминг).
- `metadata` каждого шага прогоняется через `redactData` (`@griha/observability`):
  ключи `password`/`token`/`authorization`/`secret`/`api_key` → `[REDACTED]`.

## Типы (кратко)

- `AgentTrace` — traceId, sessionId, agentVersion, status (`running|success|failed|cancelled|timeout`), steps, final.
- `AgentTraceStep` — stepId, sequence, type (`input|context|retrieval|model|tool_call|tool_result|validation|retry|error|final`), status, startedAt/finishedAt/durationMs, metadata.
- `AgentTraceFinal` — success, responseLength?, errorCode?.

## Версия агента

`getAgentVersion()`: `GRIHA_AGENT_VERSION` env → `apps/agent/package.json#version` → `"unknown"`.
Сейчас `package.json#version = "0.0.0"` (placeholder); env-переменной можно
переопределить при деплое (git sha). Вторую систему версий не создаём.

## API

- `TraceManager` — `start()` / `addStep()` / `finish()` / `reset()` / `current`.
- `TraceStore` — `save()` / `get()` / `close()`; синглтон `getTraceStore()`.
- `getAgentVersion()`.
- `registerTrace` / `getActiveTrace` / `unregisterTrace` — реестр активных trace (по sessionId), чтобы Context Builder мог добавить «context» step.
- `buildContextTrace(sources, opts)` + типы `ContextSource` / `ContextTrace` (`context-trace.ts`).
- `buildRetrievalTrace(input)` + `hashQueryText(text)` + тип `RetrievalTrace` (`retrieval-trace.ts`).
- `buildToolTrace(input)` + `hashToolArgs(args)` + `validateToolResult(result)` + тип `ToolTrace` (`tool-trace.ts`).

## ContextTrace (Prompt 03)

Отвечает на вопрос **«почему именно этот контекст оказался перед моделью»**.

- Формируется в Context Builder — `core-agent` `before_agent_start` (sub-session),
  когда контекст уже собран; кладётся как step `type: "context"` в metadata
  активного `AgentTrace` (связь через `registerTrace(sessionId, …)`).
- Хранит **структуру происхождения**, НЕ полный текст: `ContextSource =
  { sourceType, sourceId?, relevance?, selected, reason?, tokenEstimate? }`.
  Полные тексты документов/файлов в trace не попадают (нет поля `content`).
- `sourceType`: `message | memory | file | tool_result | system | retrieval | other`.
- Примеры `reason`: `"recent message"`, `"system instruction"`, `"skill instruction"`,
  `"routing hint"`, `"user profile"`, `"semantic relevance"`,
  `"inside/outside retrieval window"`, `"token budget exceeded"`, `"explicitly excluded"`.
- Truncation: при обрезке фиксируется `truncated: true` + `truncationReason`.

### Как читать «почему модель не увидела нужную информацию»

1. Найди trace по `traceId`/`sessionId` → step `context` → `metadata.context.sources`.
2. Найди источник нужного типа (`memory`/`file`/`retrieval`) по `sourceId`.
3. Если источник отсутствует → он не попал в контекст (не был выбран при сборке).
4. Если есть, но `selected: false` → смотри `reason` (`outside retrieval window`,
   `explicitly excluded`, …).
5. Если `truncated: true` → источник мог быть отрезан (`truncationReason`).

## RetrievalTrace (Prompt 04)

Отличает **три причины ошибки**, когда модели не хватило информации:

| Причина | Как увидеть в trace |
|---|---|
| 1. Информация не найдена | step `retrieval` → `candidatesCount === 0` |
| 2. Найдена, но не попала в context | `candidatesCount > 0`, но id нет в `context.sources` |
| 3. Попала, но модель ошиблась | id есть в `context.sources`, retrieval-данные корректны — проблема в использовании |

- Встроено в `memory_search` tool (`sqlite-rag-memory/index.ts`), использует
  `SqliteRagMemoryService.searchWithStats()` (candidatesCount = fts + vector до RRF).
- `RetrievalTrace = { queryId, queryType, queryTextHash?, candidatesCount,
  selectedCount, selectedSourceIds, durationMs, tokenEstimate? }`.
- Хранится как step `type: "retrieval"` в `metadata.retrieval`.
- `queryType`: `memory` (FTS5 + sqlite-vec + RRF гибрид). `queryTextHash` —
  sha256-хэш (16 hex), сырой текст запроса не хранится.
- `selectedSourceIds` (id фактов) коррелируют с `ContextSource.sourceId` —
  это связь retrieval→context.

## ToolTrace (Prompt 05)

Каждый tool call виден; после критического вызова можно понять: вызван → завершился
→ технически корректен → соответствует схеме → пригоден для следующего шага.

- Встроено в `TelegramSessionPool` подписку `session.subscribe()` (события
  `tool_execution_start` / `tool_execution_end`): `tool_call`/`tool_result` step
  c `metadata.tool = ToolTrace`.
- `ToolTrace = { toolCallId, toolName, argumentsHash?, startedAt, finishedAt?,
  durationMs?, status, resultRef?, errorCode?, retryCount? }`.
- `status`: `started | success | failed | timeout | rejected`. Сейчас
  `started`/`success`/`failed` заполняются из `isError`; `timeout`/`rejected` —
  forward-compatible (timeout — Prompt 07, rejected — gateway `tool_call` block).
- **Redaction**: `argumentsHash` = sha256 от `JSON.stringify(args)` (16 hex);
  сырые args/result не хранятся (в них могут быть секреты).
- **Validation**: `validateToolResult(result)` — минимальная последняя линия
  («tool вернул мусор?»). `empty_result` / `error_result` / `explicit_failure`.
  При invalid → дополнительный step `type: "validation"` (возможность retry/recovery).
  Существующая validation (TypeBox — вход, zod — report) НЕ дублируется.
- `retryCount` — поле объявлено, но generic tool-retry в Griha отсутствует
  (см. Architecture Map); заполнится в Prompt 07.

## Error taxonomy (Prompt 06)

При `status = "failed"` trace содержит `primaryFailure` + `failureChain`
(подробнее — [failure-diagnosis.md](failure-diagnosis.md)):

- `primaryFailure = { category, code, stepId?, toolCallId?, explanation? }`.
- `code` — `AgentErrorCode` (машинный): `MODEL_ERROR`, `TOOL_ERROR`,
  `TOOL_TIMEOUT`, `TOOL_INVALID_RESULT`, `VALIDATION_ERROR`, `CONTEXT_*`,
  `RETRIEVAL_*`, `REPORT_ERROR`, `OCR_ERROR`, `STT_ERROR`, `FILE_ERROR`,
  `TELEGRAM_ERROR`, `PERSISTENCE_ERROR`, `UNKNOWN`.
- `failureChain` — упорядоченные failed-шаги (`{ stepId, stepType, code?, note? }`).
- Mapping: `codeFromTurnCode(turnCode)`, `codeFromRenderError(renderCode)`,
  `categoryForCode(code)`.
- Проставляется в `TelegramSessionPool.finish()` (terminal state) из `turnCode`.
- `REPORT_ERROR` при schema mismatch отчёта (`INVALID_INPUT`) — через
  `codeFromRenderError`.

## Retry + TaskOutcome + AgentVersion (Prompt 07)

- **Retry**: `TraceManager.recordRetry(info)` — step `type: "retry"` +
  `retryCount++`. `RetryTrace = { attempt, kind, reason?, from?, to? }`,
  `kind`: `retry | fallback | alternative_tool | new_model_call | full_restart`.
  Существующий retry в Griha — это model fallback-цепочка (`FallbackChain`,
  `model-router.ts` → `runtimeObservability.fallback`); generic tool-retry НЕТ.
  `retryCount`/`retry` step — механизм, куда попадает retry-сигнал.
- **TaskOutcome**: `computeTaskOutcome({ ok, hadReply?, needsUserInput? })` →
  `completed | partially_completed | failed | blocked | needs_user_input | unknown`.
  Кладётся в `final.taskOutcome`. Технический success ≠ реальный success:
  approval-кнопки → `needs_user_input`, `ok=false` → `failed`.
- **AgentVersion**: `getAgentVersion()` → `GRIHA_AGENT_VERSION` env →
  `apps/agent/package.json#version` → `"unknown"`. Стабилен (кэш), пишется в
  каждый trace. Сравнение A/B версий — по `agent_version` в `agent_traces`.
- **Persistence**: `agent_traces` дополнена колонками `retry_count`,
  `primary_failure_json`, `failure_chain_json` (+ `migrate()` для старых таблиц).

## Metrics + Meta-hook (Prompt 08)

- **Metrics**: `computeMetrics(traces)` → `MetricsSummary` (success/failure rate,
  tool rates, retry rate, avg/p95 duration, context tokens, retrieval hit/empty,
  validation rate, unresolved). Агрегирует из persisted traces.
- **Diagnostic report**: `buildDiagnosticReport(traces)` — человекочитаемая сводка
  за период (top failure categories, most failing tools).
- **Read-only Meta-hook**: `toEvaluationRecord(trace)` → `AgentEvaluationRecord`
  (проекция без секретов). `TraceStore.get/list` — read-only доступ.
- Feedback (dislike/regenerate/correction) — **NOT FOUND**, linkage не реализован.

Подробнее: [metrics.md](metrics.md), [meta-harness-foundation.md](meta-harness-foundation.md).
